/* eslint-disable @typescript-eslint/explicit-function-return-type */
/*
 * ② 用户原话链 —— 「用户发的消息不能被压缩」(Ral 2026-09-11)。
 *
 * 为什么值得一条守卫:**在这之前 bl 是做反的**,而且看不出来。
 * `selectCompactCandidates` 的可压集判据只有 `isPromptContextMessage`,对 `role:'human'`
 * 一视同仁 —— 用户原话照样进摘要,此后上下文里就只剩模型复述的版本。没有任何报错,
 * UI 上也看不出来,只有在模型把用户说过的话记岔了的时候才暴露。
 *
 * 这条链断掉的方式同样静默:`userChainText` 不传 ⇒ main 的 `applyToSession` 里那个
 * `if (chain && ...)` 直接跳过,压缩照样报成功。所以「接线还在」必须单独钉。
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const cache = new Map()

const load = (relPath) => {
  const file = relPath.endsWith('.ts') ? resolve(root, relPath) : resolve(root, `${relPath}.ts`)
  if (cache.has(file)) return cache.get(file).exports
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: file
  }).outputText
  const module = { exports: {} }
  cache.set(file, module)
  new Function('exports', 'require', 'module', '__filename', '__dirname', out)(
    module.exports,
    (child) => {
      if (child.startsWith('@maestro-shared/')) return load(`src/shared/maestro/${child.slice('@maestro-shared/'.length)}`)
      if (child.startsWith('@maestro-main/')) return load(`src/main/maestro/${child.slice('@maestro-main/'.length)}`)
      if (child.startsWith('@main/')) return load(`src/main/${child.slice('@main/'.length)}`)
      if (child.startsWith('.')) return load(resolve(file, '..', child).slice(root.length + 1))
      return require(child)
    },
    module,
    file,
    resolve(file, '..')
  )
  return module.exports
}

const fail = (message) => {
  console.error(`  ✗ ${message}`)
  process.exitCode = 1
}
const assertOk = (condition, message) => {
  if (!condition) fail(message)
}

const svc = load('src/main/agent/userChainStore.service.ts')
const rec = (n, text, at = '2026-09-11 10:00', ws = '/w', tab = 'tab: none') => ({ n, at, ws, tab, text })

// —— 1. 逐字 ——————————————————————————————————————————————————————————————
// 这一段存在的全部理由。改一个字它就退化成第二份摘要。
const verbatim = '帮我把 A 改成 B，**不要**动 C。\n\n第二段：还有个 `code` 片段 —— 别改措辞。'
const records = [rec(1, '第一条'), rec(2, verbatim), rec(3, '再确认一下')]
const projection = svc.projectUserChain(records, 100_000)
assertOk(projection.quoted.length === 3, `预算充足时应全部引用,实得 ${projection.quoted.length}`)
const block = svc.renderUserChainBlock(projection, '/abs/chain/s1.jsonl')
assertOk(block.includes(verbatim), '原话必须逐字在块里,一个字符都不能改')

// —— 2. 顺序 + 元数据 ——————————————————————————————————————————————————
// Ral 2026-09-11 指定每条要带:发送时间、当时的 workspace、当时开着的页面。
assertOk(projection.quoted[0].n === 1 && projection.quoted[2].n === 3, '必须从老到新')
assertOk(block.includes('2026-09-11 10:00') && block.includes('/w'), '每条要带时间与 workspace')

// —— 3. 边界:不重复、不遗漏 ————————————————————————————————————————————
// 这是整套机制的承重点。没有这句话,模型要么整份重读(浪费上下文,正是本机制要省的),
// 要么干脆不读(那文件就白存了)。
const many = Array.from({ length: 40 }, (_, i) => rec(i + 1, 'x'.repeat(4000)))
const partial = svc.projectUserChain(many, 5_000)
assertOk(partial.quoted.length > 0 && partial.quoted.length < many.length, `应该只引用一部分,实得 ${partial.quoted.length}/${many.length}`)
assertOk(
  partial.fileOnlyCount === partial.quoted[0].n - 1,
  `"只在文件里"的条数必须正好接上引用区的起点:fileOnly=${partial.fileOnlyCount} 首条=#${partial.quoted[0].n}`
)
assertOk(partial.fileOnlyCount + partial.quoted.length === partial.total, '两段相加必须等于全量 —— 不重复、不遗漏')
const partialBlock = svc.renderUserChainBlock(partial, '/abs/chain/s1.jsonl')
assertOk(partialBlock.includes(`#1–#${partial.fileOnlyCount}`), '必须点明哪一段只在文件里')
assertOk(partialBlock.includes(`#${partial.fileOnlyCount + 1}–#${partial.total}`), '必须点明哪一段已经引用过')
assertOk(/do NOT re-read/.test(partialBlock), '必须明确告诉模型引用过的那段不要再读 —— 否则它会整份重读')
assertOk(partialBlock.includes('/abs/chain/s1.jsonl'), '必须带文件绝对路径')

// —— 4. 最新一条自己就超预算 ⇒ 留它、越预算 ————————————————————————————
// 空链等于这一刻上下文里没有任何用户意图,比越预算严重得多。
const over = svc.projectUserChain([rec(1, 'old'), rec(2, 'y'.repeat(100_000))], 1_000)
assertOk(over.quoted.length === 1 && over.quoted[0].n === 2, '最新一条超预算时必须留它,不能产出空链')

// —— 5. 空历史 ⇒ 空串 ——————————————————————————————————————————————————
// 调用方据此不落 entry;返回一个只有块头的串会让上下文里多一段空标题。
assertOk(svc.renderUserChainBlock(svc.projectUserChain([], 1000), '/p') === '', '空历史必须渲染成空串')

// —— 6. 落盘:追加、序号连续、坏行不致命 ————————————————————————————————
const dir = mkdtempSync(join(tmpdir(), 'bl-chain-'))
const path = svc.ensureSessionChainFile(dir, 'sess/with:odd*chars')
assertOk(existsSync(path), '会话建立时就要有文件(空文件而不是不存在 —— 后者读出来是错误)')
assertOk(readFileSync(path, 'utf8') === '', '新建时必须是空的')
const nameOnly = path.slice(dir.length + 1)
assertOk(!nameOnly.includes('/') && !nameOnly.includes(':') && !nameOnly.includes('*'), `文件名必须已清洗,实得 ${nameOnly}`)
assertOk(nameOnly.endsWith('.jsonl'), 'Ral 指定用 jsonl 不用 md —— 追加 O(1),一行一条,坏一行不致命')

const a = svc.appendUserChainRecord(path, { at: 't1', ws: '/w1', tab: 'tab1', text: '第一条' })
const b = svc.appendUserChainRecord(path, { at: 't2', ws: '/w2', tab: 'tab2', text: '第二条' })
assertOk(a?.n === 1 && b?.n === 2, `序号必须从 1 连续,实得 ${a?.n}/${b?.n}`)
const back = svc.readChainRecords(path)
assertOk(back.length === 2 && back[1].text === '第二条' && back[1].ws === '/w2', '读回来必须逐字且元数据齐全')

// 坏行跳过而不是整份报废 —— 这正是 jsonl 相对单个 JSON 的好处。
appendFileSync(path, '{oops not json\n')
svc.appendUserChainRecord(path, { at: 't3', ws: '', tab: '', text: '第三条' })
const afterBad = svc.readChainRecords(path)
assertOk(afterBad.length === 3, `坏行应被跳过、其余仍可读,实得 ${afterBad.length}`)
assertOk(afterBad[2].text === '第三条', '坏行之后的记录仍要读得到')

// —— 7. 预算 = 窗口的 10% ————————————————————————————————————————————————
// Ral 2026-09-11:「上下文留存的用户原话给 10% 的 context window 预算」。
assertOk(svc.USER_CHAIN_WINDOW_RATIO === 0.1, `预算比例必须是 10%,实得 ${svc.USER_CHAIN_WINDOW_RATIO}`)

// —— 8. 接线 ————————————————————————————————————————————————————————————
// 断开任一根,上面全部断言仍然全绿,而真实会话里要么不记录、要么不注入、要么压缩后原话不回来。
const agent = readFileSync(resolve(root, 'src/main/agent/maestroAgent.service.ts'), 'utf8')
assertOk(/appendUserChainRecord\(/.test(agent), '发送路径必须把用户原话记进 jsonl')
assertOk(
  /this\.recordUserChainMessage\(message, params\.sessionId, params\.context\)/.test(agent),
  '必须记 **main 真正发出去的那一份**(长粘贴已换成引用),不是渲染端存的原文'
)
assertOk(/userChainPath: chainFilePath\(/.test(agent), '表 3 必须注入这个会话的历史文件路径')

const prompt = readFileSync(resolve(root, 'src/main/agent/runtime/agentPrompt.ts'), 'utf8')
assertOk(/renderChainPathLine\(params\.userChainPath\)/.test(prompt), '动态前缀里必须有那行路径 —— newchat 起就在')

const handler = readFileSync(resolve(root, 'src/main/xpc/compaction.handler.ts'), 'utf8')
assertOk(/projectUserChain\(readChainRecords\(chainPath\)/.test(handler), '压缩时必须由 main 从文件建链')
assertOk(/USER_CHAIN_WINDOW_RATIO/.test(handler), '预算必须按窗口比例算,不能写死')

// 渲染端**不许**再建链 —— 两个来源必然漂移,而漂移的表现是长粘贴被原样注入回来。
const store = readFileSync(resolve(root, 'src/renderer/maestro/control/src/store/message.store.ts'), 'utf8')
assertOk(!/userChainText:/.test(store), '渲染端不该再提供 userChainText —— 这条路只能有一个来源')

if (!process.exitCode) console.log('[check-user-chain] ok')
