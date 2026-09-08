// ══ 行为守卫 ══ chat 面板里的链接落点 —— 网页进操作视图的 tab,其余一律拒
//
// Ral 2026-09-08 定案 A,两仓同步做。设计与证据:
// micromeet-cowork `docs/features/cowork-reply-file-links.md` #6 ·
// overmind `areas/agent-runtime/chat/links-in-message.html` #6。
//
// 这份守卫**跑真代码**:策略的两个判据是纯函数,而"函数存在"从来证明不了"判据对"。
// 尤其是 `origin === 'null'`(file:// 的 origin 就是这个字符串)那一条 —— 少了它,同源放行会把
// 世界上任何 file:// 地址都当成"面板自己",于是导航栅栏形同不存在。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { assert, projectRoot } from './_harness.mjs'

const read = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8')
const POLICY = 'src/main/maestro/windows/main/maestroControlLinkPolicy.ts'
const policySource = read(POLICY)

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText

const compiled = transpile(policySource)
assert(
  !/require\(/.test(compiled),
  'maestroControlLinkPolicy must import electron as a TYPE only, so the policy stays testable outside Electron'
)
const box = { exports: {}, module: { exports: {} }, console, queueMicrotask, URL }
runInNewContext(compiled, box)
const { isRemotePageUrl, isPanelsOwnUrl, installControlLinkPolicy } = box.exports

// ── ① 判据 ────────────────────────────────────────────────────────────────────────────────────────
const DEV_SELF = 'http://localhost:5173/maestro/control/index.html'
const PKG_SELF = 'file:///Applications/Bitterless.app/Contents/Resources/app.asar/out/renderer/maestro/control/index.html'
for (const [self, raw, expected, why] of [
  [DEV_SELF, 'https://docs.micromeet.ai/report/q3', true, '真实远端页面正是操作视图该装的东西'],
  [PKG_SELF, 'https://docs.micromeet.ai/report/q3', true, '打包版同理'],
  [DEV_SELF, 'http://localhost:5173/Users/ral/q3.pdf', false, 'dev 下裸路径会按面板自己的 origin 解析 —— 开 tab 只会落在 dev server 的 404'],
  [PKG_SELF, 'file:///Users/ral/q3.pdf', false, '本地文件归渲染层的拦截,永远不该变成一个 tab'],
  [DEV_SELF, 'javascript:alert(1)', false, '模型产出的字符串绝不能以脚本 url 形式到 loadURL'],
  [DEV_SELF, 'data:text/html,<h1>x', false, '也不能以内联文档形式'],
  [DEV_SELF, 'about:blank', false, '也不能是 about:'],
  [DEV_SELF, 'bitterless-preview://x/y', false, '自家 scheme 不经这条路'],
  [DEV_SELF, 'not a url at all', false, '解析不了的 href 不是目的地']
]) {
  assert(isRemotePageUrl(raw, self) === expected, `isRemotePageUrl(${raw}) should be ${expected} — ${why}`)
}
assert(isPanelsOwnUrl(PKG_SELF, PKG_SELF), 'the panel reloading itself must be recognised (packaged)')
assert(
  isPanelsOwnUrl('http://localhost:5173/maestro/control/index.html?t=1', DEV_SELF),
  'Vite appends a query on reload; fencing that would break the panel in dev'
)
assert(
  !isPanelsOwnUrl('file:///etc/passwd', PKG_SELF),
  'origin === "null" for file:// — the same-origin arm must exclude it, or every file:// url counts as the panel itself'
)

// ── ② 装上去之后的行为 ────────────────────────────────────────────────────────────────────────────
const drive = async (self, url, event) => {
  const opened = []
  const listeners = {}
  let openHandler = null
  installControlLinkPolicy(
    {
      setWindowOpenHandler: (fn) => {
        openHandler = fn
      },
      on: (name, fn) => {
        listeners[name] = fn
      }
    },
    self,
    {
      openTab: async (params) => {
        opened.push(params.url)
      }
    }
  )
  let prevented = false
  if (event === 'open') {
    const verdict = openHandler({ url })
    assert(verdict && verdict.action === 'deny', `window-open must always deny (${url})`)
  } else {
    assert(listeners[event], `no ${event} listener installed`)
    listeners[event]({ preventDefault: () => { prevented = true } }, url)
  }
  await new Promise((resolve) => queueMicrotask(() => queueMicrotask(resolve)))
  return { opened, prevented, fences: Boolean(listeners['will-navigate'] && listeners['will-redirect']) }
}

const remote = await drive(DEV_SELF, 'https://docs.micromeet.ai/q3', 'open')
assert(remote.opened.length === 1 && remote.opened[0] === 'https://docs.micromeet.ai/q3', 'a remote link must become a tab')
assert(remote.fences, 'both will-navigate and will-redirect must be fenced')
for (const url of ['file:///Users/ral/q3.pdf', 'javascript:alert(1)', 'http://localhost:5173/Users/ral/q3.pdf']) {
  const refused = await drive(DEV_SELF, url, 'open')
  assert(refused.opened.length === 0, `${url} must not open a tab — openTab has no scheme guard of its own`)
}
const navigated = await drive(DEV_SELF, 'https://evil.example/x', 'will-navigate')
assert(navigated.prevented, 'a same-frame navigation must be fenced, or the chat panel itself is replaced by a web page')
assert(navigated.opened.length === 1, 'and re-routed to a tab')
const reload = await drive(DEV_SELF, DEV_SELF, 'will-navigate')
assert(!reload.prevented && reload.opened.length === 0, 'the panel must still be able to reload itself')

// ── ③ 接线 ────────────────────────────────────────────────────────────────────────────────────────
const controlView = read('src/main/maestro/windows/main/maestroControlView.service.ts')
assert(/installControlLinkPolicy\(/.test(controlView), 'the control view must install the policy')
assert(
  /devEntry \|\| pathToFileURL\(entryFile\)\.toString\(\)/.test(controlView),
  'selfUrl must be derived from the same two branches that load the view — two copies drift'
)
assert(
  /openTab\(params: \{ url: string \}\): Promise<void>/.test(controlView),
  'the control view state bag must declare openTab'
)
assert(
  !/openTab\(/.test(read('src/renderer/maestro/control/src/MessageItem.vue')),
  'one policy, one place — a renderer-side copy cannot see a middle-click or a Cmd+click'
)

// ── ④ 与 cowork 的同步(cowork 不在盘上就跳过,与 sync-onlypreview-native-labels 同一惯例)───────
// Control chat 的同步方向是 cowork → bitterless(`docs/features/maestro.md` 的 parity source),
// 所以这里比的是"我有没有跟上",而不是反过来。
const COWORK_POLICY = join(
  projectRoot,
  '..',
  'micromeet-cowork/apps/cowork/src/main/modules/window-manager/windows/main/coworkLinkPolicy.ts'
)
if (!existsSync(COWORK_POLICY)) {
  console.log('[check-control-link-policy] cowork checkout absent — parity comparison skipped')
} else {
  const normalise = (source) =>
    source
      .replace(/cowork|maestro/gi, '·')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim()
  const mine = normalise(policySource)
  const theirs = normalise(readFileSync(COWORK_POLICY, 'utf8'))
  assert(
    mine === theirs,
    'the two link policies have drifted — cowork is the parity source for Control chat; port it, or state the BL-only divergence in BOTH files and relax this assertion deliberately'
  )
}

console.log('[check-control-link-policy] ok')
