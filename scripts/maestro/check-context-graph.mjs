import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { assert, readMaestro, readProject } from './_harness.mjs'

// `/view_context_graph` 这条链的守卫(docs/features/maestro-context-graph.md)。
//
// 它盯的五件事,全都是**不会报错、只会画错**的那一类:
//   ① 被压缩吸收的条目只汇总不逐条列 —— 逐条列出来画的是"我们存了什么",不是模型看到什么;
//   ② 压缩边界走本仓的 `compactionBoundary()`,包括 `firstKeptEntryId` 认不到时退到上一条
//      compaction 之后那个分支(cowork 那版退成 0 = 少报,契约 #2.1);
//   ③ 回合只由**存活的** user 条目开启,于是"第 N 轮"与模型看到的对得上;
//   ④ 认领 fail closed —— 认领不到就不可点,绝不错链;
//   ⑤ 载荷有界 —— 每块只有 preview,正文永远不过 xpc(这是它与 `/view_context` 的分界)。
//
// 组装函数**脱离 Electron / 脱离 DOM** 直接跑:上面五件都不需要真界面就能测。

const require_ = createRequire(import.meta.url)
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const moduleCache = new Map()

// 与 `check-skill-input-vars.mjs` / `check-response-body-policy.mjs` 同一份解析器 ——
// 本仓已经有三份逐字复制的副本,这里是第四个消费者,不引入第五种写法。
const resolveTsModule = (specifier, parentDir = root) => {
  if (specifier.startsWith('@maestro-main/')) return join(root, 'main', 'maestro', `${specifier.slice('@maestro-main/'.length)}.ts`)
  if (specifier.startsWith('@maestro-shared/')) return join(root, 'shared', 'maestro', `${specifier.slice('@maestro-shared/'.length)}.ts`)
  if (specifier.startsWith('@main/')) return join(root, 'main', `${specifier.slice('@main/'.length)}.ts`)
  if (specifier.startsWith('@shared/')) return join(root, 'shared', `${specifier.slice('@shared/'.length)}.ts`)
  if (specifier.startsWith('.')) {
    const base = join(parentDir, specifier)
    for (const candidate of [`${base}.ts`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.js')]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

const loadTsModule = (specifier, parentDir = root) => {
  const file = resolveTsModule(specifier, parentDir)
  if (!file) return require_(specifier)
  if (moduleCache.has(file)) return moduleCache.get(file).exports
  const mod = { exports: {} }
  moduleCache.set(file, mod)
  const output = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file
  }).outputText
  const wrapped = vm.runInThisContext(`(function(exports, require, module, __filename, __dirname) {\n${output}\n})`, { filename: file })
  wrapped(mod.exports, (child) => loadTsModule(child, dirname(file)), mod, file, dirname(file))
  return mod.exports
}

/**
 * 去掉注释再做**否定式**断言。
 *
 * 这不是洁癖:本次每个文件顶上都要**逐字引用**那条被否掉的写法(「不移植 cowork 的
 * `absorbedBoundaryIndex()`」、「别把 `timestamp: ''` 修成 `new Date()`」),按全文匹配的守卫
 * 会被自己要求写下的那段解释绊倒 —— 第一版就红在这上面。
 */
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ---------------------------------------------------------------- static · 接线

const graphSrc = readMaestro('main/agent/contextGraph.service.ts')
const exportSrc = readMaestro('main/agent/contextExport.service.ts')
const agentSrc = readMaestro('main/agent/maestroAgent.service.ts')
const contract = readMaestro('shared/coach.api.ts')
const handler = readMaestro('main/xpc/coach.handler.ts')
const controller = readMaestro('main/windows/main/maestroWindow.controller.ts')
const modal = readMaestro('renderer/control/src/ContextGraphModal.vue')
const modalLess = readMaestro('renderer/control/src/ContextGraphModal.less')
const panel = readMaestro('renderer/control/src/ChatPanel.vue')
const item = readMaestro('renderer/control/src/MessageItem.vue')
const itemLess = readMaestro('renderer/control/src/MessageItem.less')
const store = readMaestro('renderer/control/src/store/message.store.ts')
const shortcutStore = readMaestro('renderer/control/src/store/shortcut.store.ts')
const shortcutType = readMaestro('renderer/control/src/store/shortcut.type.ts')
const en = readProject('src/renderer/common/i18n/en.ts')
const zh = readProject('src/renderer/common/i18n/zh.ts')

// 一条链要全通:契约 → handler → controller → 组装。缺一环就是「命令在,点了什么都没有」。
assert(contract.includes('readContextGraph'), 'the coach contract must expose readContextGraph')
assert(handler.includes('readContextGraph'), 'the coach xpc handler must forward readContextGraph')
assert(controller.includes('readContextGraph'), 'the window controller must forward readContextGraph')
assert(agentSrc.includes('buildContextGraph'), 'the agent service must build the graph through the shared builder')
// **同一个展平映射**:结构与正文的类型口径不许各写一份 —— 两份会漂,而只有一份会被看见。
assert(graphSrc.includes('flattenEntryRows'), 'the graph must reuse the export flattening')
assert(
  exportSrc.includes('flattenEntryRows(entries).map((row) => row.row)'),
  'flattenEntries must stay a projection of flattenEntryRows (the clipboard export shape must not change)'
)
// 边界用**本仓的** `compactionBoundary()`,不是移植过来的第二份实现(契约 #2.1)。
assert(graphSrc.includes('compactionBoundary('), 'the boundary must come from this repo’s compactionBoundary()')
assert(!/absorbedBoundaryIndex/.test(codeOf(graphSrc)), 'do not port a second boundary implementation — compactionBoundary already has pi’s fallback')
// 纯函数:不读时钟、不碰文件系统(守卫要能拿到确定输出)。
assert(!/Date\.now\(\)|new Date\(|from 'node:fs'|require\('node:fs'\)/.test(codeOf(graphSrc)), 'the builder must stay pure — no clock, no filesystem')
// 认领的头部长度**两侧同一个数**。各写一个,长消息会静默停止可点。
assert(/export const CONTEXT_GRAPH_MATCH_HEAD_CHARS = 200/.test(contract), 'the match-head length must live in the shared contract')
assert(panel.includes('CONTEXT_GRAPH_MATCH_HEAD_CHARS'), 'the panel must slice message heads with the shared constant')
assert(graphSrc.includes('CONTEXT_GRAPH_MATCH_HEAD_CHARS'), 'main must clamp the incoming head with the same constant')
// 契约里**刻意没有**这两个字段(#2.5 与 cowork 的同一条删除)。留一个永远填不上的字段 = 读起来像"我们有这个信息"。
const graphView = contract.slice(contract.indexOf('export interface ContextGraphView'), contract.indexOf('export type ContextGraphResult'))
assert(graphView.length > 0, 'ContextGraphView must exist in the contract')
assert(!/ioLogDir|contextWindow/.test(graphView), 'the view must carry neither ioLogDir (dead chain here) nor contextWindow (token vs char)')

// 别名边界:maestro 树里不许出现宿主别名(`_harness.mjs` 的 `assertMaestroAliasBoundary` 会全量扫,
// 这里只钉住本次新增的两个文件,让报错离改动更近)。
for (const [name, source] of [['ContextGraphModal.vue', modal], ['ChatPanel.vue', panel]]) {
  assert(!/from '@shared\//.test(source), `${name} must import the contract as @maestro-shared/*, not @shared/*`)
}

// ---------------------------------------------------------------- static · 渲染层

// 跳转落点这一侧:store 的单一高亮字段 + 行上的 data 属性 + 成对的 1.6s。少任何一个都是"点了没反应"。
assert(/scrollToMessage\(messageId: string\): boolean/.test(store), 'the store must expose scrollToMessage')
assert(
  /this\.stickToBottom = false[\s\S]{0,120}this\.highlightMessageId = messageId/.test(store),
  'stickToBottom must be released BEFORE the jump — five call sites force-scroll and setListEl re-arms it'
)
assert(/MESSAGE_JUMP_HIGHLIGHT_MS = 1600/.test(store), 'the highlight lifetime must be 1600ms')
assert(/1\.6s/.test(itemLess), 'the flash animation must be 1.6s — paired with MESSAGE_JUMP_HIGHLIGHT_MS')
assert(item.includes(':data-message-id="props.message.id"'), 'each message row must carry its id for the jump to find')
assert(/message-item--jumped/.test(item) && /message-item--jumped/.test(itemLess), 'the jump target must flash')
// 闪光用**外发光**而不是底色:maestro 的气泡底色带语义(connector 绿 / error 红),底色闪会盖掉它们。
const jumpedRule = itemLess.slice(itemLess.indexOf('.message-item--jumped'))
assert(/box-shadow/.test(jumpedRule.slice(0, 400)), 'the flash must be a glow, not a background — bubble tints are semantic here')
assert(!/^\s*background(-color)?:/m.test(jumpedRule.slice(0, 400)), 'the flash must not paint a background over the semantic bubble tints')

// **跳到了才关** —— 落点在遮罩底下,关掉一个没落地的跳转就是骗人。
assert(/if \(messageStore\.scrollToMessage\(block\.messageId\)\) emit\('close'\)/.test(modal), 'the modal must close only when the jump actually landed')
// 不可点 = 连按钮语义都不给。
assert(/:is="block\.messageId \? 'button' : 'div'"/.test(modal), 'a block with no UI carrier must not even be a button')
// 「界面上没有它」与「认领不到」是**两句不同的话**(见 lockLabelOf)。
assert(/lockLabelOf/.test(modal) && /notLocated/.test(modal) && /notShown/.test(modal), 'the two not-clickable reasons must read as two different sentences')
// 弹窗只排版,不分类不算量。
assert(!/flattenEntr|buildContextGraph|compactionBoundary/.test(codeOf(modal)), 'the modal must not assemble or classify anything — main owns the structure')
// 遮罩半透明 + 压在拖拽提示层(20)之上,且是**面板内**的绝对定位。
assert(/position: absolute/.test(modalLess) && /inset: 0/.test(modalLess), 'the overlay must be panel-scoped absolute positioning')
const zIndex = Number((/\.context-graph \{[\s\S]*?z-index: (\d+)/.exec(modalLess) || [])[1])
assert(zIndex > 20, `the overlay must sit above .chat-panel__drop-overlay (z-index 20), got ${zIndex}`)
assert(/rgb\([^)]*\/\s*\d+%?\)|rgba\(/.test(modalLess.slice(modalLess.indexOf('.context-graph {'), modalLess.indexOf('.context-graph__sheet'))), 'the overlay must stay translucent — the jump target sits underneath it')

// **一条边框都不许有**(Ral 2026-09-09 的全局规则:分层靠留白 / 底色 / 圆角,不靠线)。
// 判据是「宽度非 0 的 border」而不是「出现过 border 这个词」:两个真按钮**必须**显式写 `border: 0`,
// 否则 Chromium 对裸 `<button>` 的 UA 默认值就是"灰底 + 1px 边框"(CLAUDE.md 记的那个坑)。
const modalClasses = (modal.match(/:?class="[^"]*"/g) || []).join(' ')
assert(!/\bborder(?:-|\b)/.test(modalClasses), 'the modal must not put border utilities in class attributes')
// 先取出所有 border 声明,再在 JS 里筛「非 0」——**不要**把否定写进正则的 `(?!0\b)`:
// 前面那个 `\s*` 会回退成匹配零个空格,于是 `border: 0;` 里的 ` 0` 反而满足了断言,守卫当场假红。
// `border-radius` 天然不在这个模式里(`-radius` 不在方位分支里),所以圆角不用另外排除。
const nonZeroBorders = (modalLess.match(/^[ \t]*border(?:-(?:top|right|bottom|left))?[ \t]*:[^;]+;/gm) || []).filter(
  (rule) => !/:[ \t]*(?:0|none)[ \t]*;/.test(rule)
)
assert(nonZeroBorders.length === 0, `the graph must draw no borders — depth/background/whitespace only, found: ${nonZeroBorders.join(' ')}`)
assert(/border:\s*0/.test(modalLess), 'the two <button> elements must reset the UA border explicitly')
assert(!/\bborder:\s*1px|dashed|dotted/.test(modalLess), 'no dashed/dotted outlines either — the absorbed band uses a hatch background')
assert(/repeating-linear-gradient/.test(modalLess), 'the absorbed band must read as a hatch (gone), not as a dashed box')
// 抬起 = 可点。静态阴影被删、或不可点的块也被抬起,都要红。
const linkedRule = modalLess.slice(modalLess.indexOf('.context-graph__block--linked'), modalLess.indexOf('.context-graph__block--locked'))
assert(/box-shadow/.test(linkedRule), 'a clickable block must be the raised one — elevation IS the affordance')
// 不可点的块要**平**。判据同样是「非 none 的 box-shadow」而不是「出现过 box-shadow」——
// 那条规则里显式写着 `box-shadow: none`(把基类可能带的抬起摘掉),按出现与否判会假红。
const lockedRule = modalLess.slice(modalLess.indexOf('.context-graph__block--locked'), modalLess.indexOf('.context-graph__block__rail'))
const lockedShadows = (lockedRule.match(/^[ \t]*box-shadow[ \t]*:[^;]+;/gm) || []).filter((rule) => !/:[ \t]*none[ \t]*;/.test(rule))
assert(lockedShadows.length === 0, `a non-clickable block must stay flat, found: ${lockedShadows.join(' ')}`)

// 第四条命令:封闭联合 + switch 分派 + 注册表,三处都要有(漏一处是 `unknown command`)。
assert(/'\/view_context_graph'/.test(shortcutType), 'the command name must join the closed union')
assert(/case '\/view_context_graph':/.test(shortcutStore), 'the store must dispatch the command explicitly')
assert(/openContextGraph: \(\) => Promise<void>/.test(shortcutType), 'the run context must carry the injected openContextGraph')
assert(/name: '\/view_context_graph'/.test(panel), 'the panel must register the command')
assert(/openContextGraph: async \(\)/.test(panel), 'the panel must inject the callback (the store stays DOM-free)')
assert(!/readContextGraph/.test(codeOf(shortcutStore)), 'the store must not read the graph itself — the panel injects that callback')
// 摘要只送**模型真会看到**的消息,且用**原文**(i18n 改写过的字符串一个字都对不上)。
assert(/promptExcluded/.test(panel) && /message\.content\.slice\(0, CONTEXT_GRAPH_MATCH_HEAD_CHARS\)/.test(panel), 'the digest must filter prompt-excluded rows and send raw content heads')

// i18n:两张表都要有(缺键就是 typecheck 红,这里先给一句人话)。
for (const key of ['contextGraph:', 'slashViewContextGraph:', 'notLocated:', 'notShown:', 'absorbedNote:']) {
  assert(en.includes(key), `en.ts is missing ${key}`)
  assert(zh.includes(key), `zh.ts is missing ${key}`)
}
assert(readProject('package.json').includes('"check:maestro"'), 'the umbrella must stay wired as a package script')

// ---------------------------------------------------------------- runtime · 结构

const { buildContextGraph, CONTEXT_GRAPH_PREVIEW_CHARS } = loadTsModule('@main/agent/contextGraph.service')

const message = (id, role, content, extra = {}) => ({ type: 'message', id, message: { role, content, ...extra } })
const assistant = (id, said, calls = []) => ({
  type: 'message',
  id,
  message: {
    role: 'assistant',
    content: [...(said ? [{ type: 'text', text: said }] : []), ...calls.map((call) => ({ type: 'toolCall', name: call.name, arguments: call.args }))]
  }
})
const base = { sessionId: 's', systemPrompt: 'SYSTEM '.repeat(50), timestamp: '' }

// 一轮:user → assistant(说话 + 调用) → tool_result → assistant(收尾),然后第二轮。
const entries = [
  message('e1', 'user', 'CONTEXT PREFIX\n\nUser message: read the report'),
  assistant('e2', 'looking at it', [{ name: 'read_file', args: { path: '/x.pdf' } }]),
  message('e3', 'toolResult', [{ type: 'text', text: '# Report body' }], { toolName: 'read_file' }),
  assistant('e4', 'the report says 42'),
  message('e5', 'user', 'CONTEXT PREFIX\n\nUser message: thanks'),
  assistant('e6', 'you are welcome')
]
const digests = [
  { id: 'm1', role: 'human', head: 'read the report' },
  { id: 'm2', role: 'ai', head: 'looking at it' },
  { id: 'm3', role: 'ai', head: 'the report says 42' },
  { id: 'm4', role: 'human', head: 'thanks' },
  { id: 'm5', role: 'ai', head: 'you are welcome' }
]
const graph = buildContextGraph({ ...base, entries, messages: digests })

assert(
  graph.blocks.map((block) => block.type).join(',') === 'user,assistant,tool_call,tool_result,assistant,user,assistant',
  `unexpected block types: ${graph.blocks.map((block) => block.type)}`
)
// **回合**:一条 user 开启一轮;工具往返留在开启它的那一轮里。
assert(graph.blocks.map((block) => block.turn).join(',') === '1,1,1,1,1,2,2', `unexpected turns: ${graph.blocks.map((b) => b.turn)}`)
assert(graph.turns === 2, `two user messages = two turns, got ${graph.turns}`)
assert(graph.blocks.every((block, index) => block.i === index + 1), 'block indexes must be 1..n with no holes')
const call = graph.blocks.find((block) => block.type === 'tool_call')
assert(call.tool === 'read_file' && call.preview.includes('/x.pdf'), 'a tool call must carry its name and arguments')
assert(graph.blocks.find((block) => block.type === 'tool_result').tool === 'read_file', 'a tool result must carry its tool name')

// ---------------------------------------------------------------- runtime · 可点性

const idOf = (type, nth = 0) => graph.blocks.filter((block) => block.type === type)[nth].messageId
assert(idOf('user') === 'm1' && idOf('user', 1) === 'm4', 'user blocks must claim their own messages in order')
assert(idOf('assistant') === 'm2' && idOf('assistant', 1) === 'm3' && idOf('assistant', 2) === 'm5', 'assistant blocks must claim in order')
for (const type of ['tool_call', 'tool_result']) {
  assert(graph.blocks.filter((block) => block.type === type).every((block) => !block.messageId), `${type} must never be clickable`)
}

// 工具块**不参与认领** —— 而且必须是"不参与",不是"碰巧配不上"。这组夹具刻意让工具参数里**含有**
// 一条 ai 消息的头部(模型把要写的正文交给 write_file,又在回复里念了一遍,很常见):
// 一旦工具块也去认领,它就会抢走那条消息,而聊天里那条 assistant 反而变成不可点。
const echo = [
  message('w1', 'user', 'User message: write the note'),
  assistant('w2', 'writing the note', [{ name: 'write_file', args: { text: 'the note body' } }]),
  message('w3', 'toolResult', [{ type: 'text', text: 'ok' }], { toolName: 'write_file' }),
  assistant('w4', 'the note body')
]
const echoGraph = buildContextGraph({
  ...base,
  entries: echo,
  messages: [
    { id: 'w-m1', role: 'human', head: 'write the note' },
    { id: 'w-m2', role: 'ai', head: 'writing the note' },
    { id: 'w-m3', role: 'ai', head: 'the note body' }
  ]
})
assert(
  echoGraph.blocks.map((block) => `${block.type}:${block.messageId || '-'}`).join(',') ===
    'user:w-m1,assistant:w-m2,tool_call:-,tool_result:-,assistant:w-m3',
  `a tool block must not claim a message even when it contains one: ${echoGraph.blocks.map((b) => `${b.type}:${b.messageId || '-'}`)}`
)

// 认领 **fail closed**:摘要缺席 = 全部不可点,而不是按顺序硬配。
assert(buildContextGraph({ ...base, entries }).blocks.every((block) => !block.messageId), 'with no digests nothing may be clickable')
// role 对但正文对不上(例如被 i18n 改写过的那种)绝不能错链到隔壁。
assert(
  buildContextGraph({ ...base, entries, messages: [{ id: 'x', role: 'human', head: 'something else entirely' }] }).blocks.every((block) => !block.messageId),
  'a digest that does not appear in the entry text must not be claimed'
)
// 游标只前进:两条**一字不差**的 user 消息,第二块认领第二条,而不是又认领第一条。
const twice = buildContextGraph({
  ...base,
  entries: [message('t1', 'user', 'User message: ping'), message('t2', 'user', 'User message: ping')],
  messages: [{ id: 'a', role: 'human', head: 'ping' }, { id: 'b', role: 'human', head: 'ping' }]
})
assert(twice.blocks.map((block) => block.messageId).join(',') === 'a,b', 'identical messages must be claimed in order, never twice')
// 头部在**进程边界**上被夹到 200:渲染层送 250 字符,前 200 对得上就该认领。
// 这一条同时是那次截断的**存在性**测试:不截的话整条 253 字符找不到,块会莫名不可点。
const longBody = 'a'.repeat(250)
const longHead = buildContextGraph({
  ...base,
  entries: [message('l1', 'user', `User message: ${longBody}`)],
  messages: [{ id: 'long', role: 'human', head: `${longBody}ZZZ` }]
})
assert(longHead.blocks[0].messageId === 'long', 'main must clamp the incoming head to the shared length before matching')

// ---------------------------------------------------------------- runtime · 压缩边界

const compacted = [
  message('c1', 'user', 'User message: old question'),
  assistant('c2', 'old answer'),
  { type: 'compaction', id: 'c3', summary: 'SUMMARY of the first turn', firstKeptEntryId: 'c4', tokensBefore: 9000 },
  message('c4', 'user', 'User message: new question'),
  assistant('c5', 'new answer')
]
const after = buildContextGraph({
  ...base,
  entries: compacted,
  messages: [
    { id: 'o1', role: 'human', head: 'old question' },
    { id: 'o2', role: 'ai', head: 'old answer' },
    { id: 'n1', role: 'human', head: 'new question' },
    { id: 'n2', role: 'ai', head: 'new answer' }
  ]
})
// ① 吸收掉的只进合计,**不进块列表**。
assert(after.blocks.map((block) => block.type).join(',') === 'compaction,user,assistant', `absorbed entries must not be listed: ${after.blocks.map((b) => b.type)}`)
assert(after.absorbed?.blocks === 2, `the absorbed pair must be counted, got ${after.absorbed?.blocks}`)
assert(after.absorbed.byType.map((total) => total.type).sort().join(',') === 'assistant,user', 'the absorbed aggregate must keep its type breakdown')
assert(after.absorbed.chars === after.absorbed.byType.reduce((sum, total) => sum + total.chars, 0), 'the absorbed total must equal its own breakdown')
// summary 那条自己**活着** —— 它就是模型现在看到的那段。
assert(after.blocks[0].type === 'compaction' && after.blocks[0].preview.includes('SUMMARY'), 'the compaction summary itself stays in the context')
assert(!after.blocks[0].messageId, 'the summary block has no chat message behind it')
// ② 回合只由存活的 user 开启。
assert(after.turns === 1 && after.blocks[1].turn === 1, `turns must count live user messages only, got ${after.turns}`)
// ③ 合计与吸收**分开**。
assert(
  after.totalChars === base.systemPrompt.length + after.blocks.reduce((sum, block) => sum + block.chars, 0),
  'totalChars must exclude absorbed entries'
)

// **这就是本仓与 cowork 的那个差异**(契约 #2.1):`firstKeptEntryId` 认不到任何条目时,边界退到
// 上一条 compaction **之后**,而不是退到 0。退到 0 = 报告"什么都没被吸收",一个方向为"少报"的偏差。
const orphaned = [
  message('p1', 'user', 'User message: dropped question'),
  assistant('p2', 'dropped answer'),
  { type: 'compaction', id: 'p3', summary: 'SUMMARY after the tail was cleared', firstKeptEntryId: 'gone-with-the-tail', tokensBefore: 9000 },
  message('p4', 'user', 'User message: kept question')
]
const fallback = buildContextGraph({ ...base, entries: orphaned })
assert(fallback.absorbed?.blocks === 2, `an unresolvable firstKeptEntryId must still absorb what the summary ate, got ${fallback.absorbed?.blocks}`)
assert(
  fallback.blocks.map((block) => block.type).join(',') === 'compaction,user',
  `the fallback boundary must land right after the compaction row: ${fallback.blocks.map((b) => b.type)}`
)
assert(fallback.turns === 1, `only the kept user row opens a turn after the fallback, got ${fallback.turns}`)

// ---------------------------------------------------------------- runtime · 载荷有界 + pending

const bounded = buildContextGraph({ ...base, entries: [message('h1', 'user', 'x'.repeat(50_000))] })
assert(bounded.blocks[0].chars === 50_000, 'the block must report the real size')
assert(bounded.blocks[0].preview.length <= CONTEXT_GRAPH_PREVIEW_CHARS, 'the preview must be capped')
assert(!('text' in bounded.blocks[0]), 'a block must never carry the full text — that is what /view_context is for')
assert(bounded.systemPreview.length <= CONTEXT_GRAPH_PREVIEW_CHARS, 'the system preview must be capped too')
// 空历史**说出来**,不拿渲染端消息冒充。
const empty = buildContextGraph({ ...base, entries: [] })
assert(empty.noHistory && empty.blocks.length === 0 && empty.turns === 0, 'an empty history must say so')
assert(empty.systemChars === base.systemPrompt.length, 'the system prompt is context even with no history')
// pending 段:这一次 send 会追加的东西,单独算(它还没进上下文)。
const pending = buildContextGraph({ ...base, entries: [], pending: { workspace: '/ws', attachments: ['/a.pdf'], draft: 'assembled turn prompt' } })
assert(pending.pending.draft === 'assembled turn prompt' && pending.pending.attachments.length === 1, 'pending must carry what this send appends')
assert(pending.pending.chars === 'assembled turn prompt'.length + '/a.pdf'.length, 'pending chars must count draft + attachment paths')
assert(pending.pending.workspace === '/ws', 'the bound workspace must reach the pending band')
// `byType` 里不许出现 system / pending —— 弹窗的分布条自己在两头补这两段,重了就是重复的 Vue key。
assert(!graph.byType.some((total) => total.type === 'system' || total.type === 'pending'), 'byType must hold entry types only')

console.log(`[check-context-graph] ok ${JSON.stringify({ blocks: graph.blocks.length, turns: graph.turns, absorbed: after.absorbed.blocks, fallbackAbsorbed: fallback.absorbed.blocks, byType: graph.byType.length })}`)
