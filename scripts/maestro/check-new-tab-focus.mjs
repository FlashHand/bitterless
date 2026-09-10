// ══ 行为守卫 ══ 操作者开的空白 tab 自动聚焦地址栏
//
// 契约:`docs/features/maestro-new-tab-focus-address-bar.md` #5(姊妹落地在 micromeet-cowork
// `docs/features/new-tab-focus-address-bar.md`)。
//
// 这四条钉的都是"漏了不报错"的坑 —— 症状只是某个入口不聚焦,typecheck 看不见,视觉验收也只在
// 那一个入口才复现。
//  1. 判据只有一个定义点:`focusAddressBarForBlankTab` / `MAESTRO_FOCUS_ADDRESS_CHANNEL` 各只在
//     newTabFocus.ts 声明一次。抄第二份 = 两条频道名或两种交接顺序并存。
//  2. 所有建 tab 的入口都经过它:调用点恰好一个且在 `newTab()` 里,`claimSpareTab({})`(空 meta)
//     也恰好一次且在同一个方法里 —— 新的空白 tab 入口必须复用 `newTab()`,自己去 claimSpareTab
//     就红。18 个入口各判一次必然漏(契约 #2.1)。
//  3. 时序:聚焦排在 `await this.activateTab(` 之后 —— 抢焦点的不是某个 view 主动 focus,而是
//     activateTab 里 `previous.view.setVisible(false)` 把焦点丢掉,先聚焦就被那一行抹掉;
//     主进程侧 `win.webContents.focus()` 排在 broadcast 之前 —— 反了会得到"input 有焦点环、
//     打字却进了网页"。
//  4. 渲染层单点,且 `focusAddress()` 三样齐全:少 `nextTick` 的症状是"从 composite tab 开新 tab
//     时不聚焦"(上一个 tab 的 disabled 还挂在 DOM 上,浏览器静默忽略 focus());少 `select()`
//     就是需求少做一半。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { assert, projectRoot } from './_harness.mjs'

const FOCUS_MODULE = 'src/main/maestro/windows/main/newTabFocus.ts'
const BROWSER_VIEW = 'src/main/maestro/windows/main/maestroBrowserView.service.ts'
const MENU_BAR_STORE = 'src/renderer/maestro/home/src/components/MenuBar/menuBar.store.ts'
const MENU_BAR_VUE = 'src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue'

const sources = []
const walk = (directory) => {
  for (const entry of readdirSync(join(projectRoot, directory))) {
    const relativePath = join(directory, entry)
    if (statSync(join(projectRoot, relativePath)).isDirectory()) walk(relativePath)
    else if (['.ts', '.vue'].includes(extname(entry))) sources.push(relativePath)
  }
}
walk('src')

// 反向断言一律读去注释的源码:解释这条守卫为什么存在的注释本身会把它匹配红。
const codeOnly = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const code = new Map(sources.map((relativePath) => [relativePath, codeOnly(readFileSync(join(projectRoot, relativePath), 'utf8'))]))
const at = (relativePath) => relative('.', relativePath)
/** 方法体 = 声明处到第一条二级缩进的收尾花括号(嵌套的 try/catch 收在四格,不会误命中)。 */
const methodBody = (text, signature) => {
  const start = text.indexOf(signature)
  assert(start > 0, `expected to find \`${signature}\``)
  return text.slice(start, text.indexOf('\n  }', start))
}

// ── ① 判据只有一个定义点,别处只能 import ────────────────────────────────────────────────────────
for (const name of ['focusAddressBarForBlankTab', 'MAESTRO_FOCUS_ADDRESS_CHANNEL']) {
  const declaredIn = []
  for (const [relativePath, text] of code) {
    const hits = text.match(new RegExp(`\\b(?:const|let|var|enum|function)\\s+${name}\\b`, 'g'))
    if (hits) declaredIn.push(`${at(relativePath)} ×${hits.length}`)
  }
  assert(
    declaredIn.length === 1 && declaredIn[0] === `${at(FOCUS_MODULE)} ×1`,
    `${name} must be declared exactly once, in ${FOCUS_MODULE} — found: ${declaredIn.join(', ') || 'nowhere'}. ` +
      'A second copy means two channel names or two hand-off orders coexist, and only one of them works.'
  )
}
const focusModule = code.get(FOCUS_MODULE)
assert(
  /^export const MAESTRO_FOCUS_ADDRESS_CHANNEL = 'coach\/focus-address'$/m.test(focusModule),
  `${FOCUS_MODULE}: the channel must stay the plain literal 'coach/focus-address' (the repo's coach/* convention)`
)

// ── ② 所有空白 tab 入口都汇进 newTab(),聚焦只从那里发起 ─────────────────────────────────────────
const callers = [...code].flatMap(([relativePath, text]) =>
  (text.match(/focusAddressBarForBlankTab\s*\(/g) ?? []).map(() => at(relativePath))
)
assert(
  callers.length === 1 && callers[0] === at(BROWSER_VIEW),
  `focusAddressBarForBlankTab() must be called exactly once, from newTab() in ${BROWSER_VIEW} — found: ` +
    `${callers.join(', ') || 'nowhere'}. Per-entry focus calls are how a tab that should NOT steal focus ` +
    '(agent tool, window.open, session restore) starts stealing it.'
)
const browserView = code.get(BROWSER_VIEW)
const newTabBody = methodBody(browserView, 'async newTab(): Promise<void> {')
assert(
  /focusAddressBarForBlankTab\s*\(/.test(newTabBody),
  `${BROWSER_VIEW}: the single focusAddressBarForBlankTab() call must sit inside newTab() — the criterion IS ` +
    '"did this go through newTab()", so a call anywhere else redefines it.'
)
const blankClaims = [...code].flatMap(([relativePath, text]) =>
  (text.match(/claimSpareTab\(\{\s*\}\)/g) ?? []).map(() => at(relativePath))
)
assert(
  blankClaims.length === 1 && blankClaims[0] === at(BROWSER_VIEW) && /claimSpareTab\(\{\s*\}\)/.test(newTabBody),
  `\`claimSpareTab({})\` (blank tab) must appear exactly once, inside newTab() in ${BROWSER_VIEW} — found: ` +
    `${blankClaims.join(', ') || 'nowhere'}. A new blank-tab entry has to reuse newTab(); claiming a spare slot ` +
    'on its own silently opts that entry out of the focus hand-off.'
)

// ── ③ 时序:聚焦在 activateTab 之后;夺原生焦点在广播之前 ────────────────────────────────────────
assert(
  newTabBody.indexOf('await this.activateTab(') < newTabBody.indexOf('focusAddressBarForBlankTab('),
  `${BROWSER_VIEW}: focusAddressBarForBlankTab() must come AFTER \`await this.activateTab(\` in newTab(). ` +
    "activateTab's `previous.view.setVisible(false)` drops whatever had focus — focusing first gets wiped by it."
)
assert(
  focusModule.indexOf('win.webContents.focus()') > 0 &&
    focusModule.indexOf('win.webContents.focus()') < focusModule.indexOf('xpcMain.broadcast('),
  `${FOCUS_MODULE}: \`win.webContents.focus()\` must run BEFORE the broadcast. The address bar lives in the host ` +
    'webContents; broadcasting first leaves the input with a focus ring while the keystrokes go to the web view.'
)

// ── ④ 渲染层单点 + focusAddress() 三样齐全 ───────────────────────────────────────────────────────
const rendererMentions = [...code].filter(
  ([relativePath, text]) =>
    relativePath.startsWith(join('src', 'renderer')) &&
    /MAESTRO_FOCUS_ADDRESS_CHANNEL|coach\/focus-address/.test(text)
)
assert(
  rendererMentions.length === 1 && at(rendererMentions[0][0]) === at(MENU_BAR_STORE),
  `the focus channel may be named in exactly one renderer file (${MENU_BAR_STORE}, the address bar's controller) — ` +
    `found: ${rendererMentions.map(([relativePath]) => at(relativePath)).join(', ') || 'nowhere'}. ` +
    'A second listener races the first and only one of them ends up holding the caret.'
)
const menuBarStore = code.get(MENU_BAR_STORE)
const subscriptions = menuBarStore.match(/subscribe\(\s*(?:MAESTRO_FOCUS_ADDRESS_CHANNEL|'coach\/focus-address')/g) ?? []
assert(
  subscriptions.length === 1,
  `${MENU_BAR_STORE}: expected exactly one subscription to the focus channel — found ${subscriptions.length}`
)
const focusAddressBody = methodBody(menuBarStore, 'async focusAddress(): Promise<void> {')
for (const [fragment, why] of [
  [
    'await nextTick()',
    'coach/tabs lands in the same burst, so Vue has not applied the new tab\'s :disabled yet — without the tick, ' +
      'opening a tab from a composite / fixed tab focuses a still-disabled input and the browser ignores it silently'
  ],
  ['.focus()', 'nothing receives the caret'],
  ['.select()', 'requirement #1 is only half done — the existing text is left un-selected']
]) {
  assert(
    focusAddressBody.includes(fragment),
    `${MENU_BAR_STORE}: focusAddress() must contain \`${fragment}\` — without it, ${why}.`
  )
}

// ── ⑤ 渲染层的元素绑定 —— 少了它整条特性静默失效 ──────────────────────────────────────────────
// 复核实测:把 input 上的 `ref="addressInput"` 或 onMounted 里的 bindAddressInput(...) 任删一处,
// 上面四条断言全绿,而 `this.addressInput` 恒为 null、`focusAddress()` 里的 `?.focus()` 是 no-op。
// 也就是说没有这一条,守卫守的是"消息发出去了",不是"光标真的进了输入框"。
const menuBarVue = code.get(MENU_BAR_VUE)
assert(
  /ref="addressInput"/.test(menuBarVue),
  `${MENU_BAR_VUE}: the address input must carry \`ref="addressInput"\` — without it the store's handle stays null and focusAddress() is a silent no-op.`
)
assert(
  /bindAddressInput\(/.test(menuBarVue),
  `${MENU_BAR_VUE}: onMounted must hand the input element to the store via bindAddressInput(...) — the ref alone never reaches focusAddress().`
)
const binds = (menuBarStore.match(/bindAddressInput\(/g) ?? []).length
assert(
  binds === 1,
  `${MENU_BAR_STORE}: expected exactly one bindAddressInput() definition — found ${binds}. Two handles means whichever bound last wins, silently.`
)

console.log('[check-new-tab-focus] ok')
