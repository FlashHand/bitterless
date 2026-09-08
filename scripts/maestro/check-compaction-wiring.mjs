#!/usr/bin/env node
// ══ 接线守卫 ══ 上下文压缩的 main 侧装配层**真的活着**。
//
// 为什么需要它:这条链上每一环都是「看起来接好了,其实是死的」那一类失效 ——
//
//   1. handler 靠**构造副作用**注册(`new CompactionHandler()` 在模块作用域自动注册
//      `xpc:CompactionHandler/*`)。没有人 import 它 ⇒ 一个字都不报,渲染端调用直接在 xpc 层失败;
//   2. emitter 用的字符串必须**逐字等于类名**。改类名不改字符串 ⇒ 同样是运行期才炸;
//   3. `usageLedger` 没人喂 ⇒ `shouldCompact` 永远报 `no-usage`,压缩**永远不触发**,
//      而从外面看完全正常(它老老实实返回了一个 reply)。这是抽取那一轮标为「最大的缺口」的那一条;
//   4. 候选批必须来自**已存在**的 agent。用会创建会话的那个取,等于给模型压一批它从没见过的上下文。
//
// 上面每一条都对应一个具名断言。**这个文件不验压缩算法** —— 那是
// `agent/compaction/*`(与 cowork 逐字相同)与 `tests/maestro/maestroCompactionHandler.test.mjs` 的事。
//
// 设计依据:`areas/agent-runtime/agent-design-parity.md` 裁决一。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const fail = []
const ok = (condition, message) => {
  if (!condition) fail.push(message)
}

const HANDLER = 'src/main/xpc/compaction.handler.ts'
const handler = read(HANDLER)
const service = read('src/main/agent/maestroAgent.service.ts')
const shared = read('src/shared/maestro/maestroChat.api.ts')

// ── 1. 类名 ⇔ emitter 字符串 ⇔ 契约,三者对齐 ────────────────────────────────────────────
ok(
  /class CompactionHandler extends XpcMainHandler implements MaestroCompactionApi/.test(handler),
  `${HANDLER}: 类必须叫 CompactionHandler 并 implements MaestroCompactionApi —— ` +
    'renderer 侧 `createXpcRendererEmitter<MaestroCompactionApi>(\'CompactionHandler\')` 的字符串是**类名**,' +
    '改一边不改另一边只会在运行期炸'
)
ok(
  /export const compactionHandler = new CompactionHandler\(\)/.test(handler),
  `${HANDLER}: 必须在模块作用域实例化 —— 注册是构造副作用,不实例化就没有 xpc 端点`
)
for (const method of ['shouldCompact', 'compact', 'cutPoint']) {
  ok(new RegExp(`async ${method}\\(`).test(handler), `${HANDLER}: 缺 ${method}()`)
  ok(new RegExp(`${method}\\(params:`).test(shared), `maestroChat.api.ts: MaestroCompactionApi 缺 ${method}()`)
}

// ── 2. 真的被注册了 ──────────────────────────────────────────────────────────────────────
// 只要有**任一**注册枢纽 side-effect import 它就算过 —— 具体放根 xpc 树还是 maestro 那棵是另一回事,
// 这里钉的是「有人 import」。判据刻意宽:import 路径的写法不该被这条守卫锁死。
const hubs = ['src/main/xpc/xpc.helper.ts', 'src/main/maestro/xpc/xpc.helper.ts']
const registered = hubs.some((hub) => /import ['"][^'"]*compaction\.handler['"]/.test(read(hub)))
ok(
  registered,
  `没有任何注册枢纽 import ${HANDLER} —— 注册是构造副作用,没被 import 的 handler 不存在。` +
    `候选枢纽:${hubs.join(' / ')}`
)

// ── 3. usageLedger 有模块、而且每个 MaestroAgent 构造点都喂它 ────────────────────────────
const LEDGER = 'src/main/agent/runtime/usageLedger.ts'
ok(/export const usageLedger/.test(read(LEDGER)), `${LEDGER}: 缺 usageLedger 导出`)
ok(handler.includes("from '@main/agent/runtime/usageLedger'"), `${HANDLER}: 触发判定必须读 usageLedger`)

// 判据是**逐个构造点**,不是「文件里出现过 onUsage」:漏的那次一定是新加的第三个构造点,
// 而按文件计数的判据对它一声不吭。
const agentSites = [...service.matchAll(/new MaestroAgent\(\{[\s\S]*?\n(\s*)\}\)/g)]
ok(agentSites.length >= 2, `maestroAgent.service.ts: 只找到 ${agentSites.length} 个 MaestroAgent 构造点,判据失效了 —— 先修判据`)
for (const [index, site] of agentSites.entries()) {
  ok(
    /onUsage:\s*\(_delta, total\) =>\s*usageLedger\.set\(/.test(site[0]),
    `maestroAgent.service.ts: 第 ${index + 1} 个 MaestroAgent 构造点没有接 onUsage → usageLedger.set。` +
      '少接一个 ⇒ 那些会话的 shouldCompact 永远报 no-usage ⇒ 压缩永远不触发,而外面看不出任何异常'
  )
}

// ── 4. 候选批只从已存在的 agent 来 ──────────────────────────────────────────────────────
ok(
  handler.includes('getExistingMaestroAgent('),
  `${HANDLER}: 候选批必须问 getExistingMaestroAgent —— 「已存在」是承重的`
)
ok(
  !/getMaestroAgent\(/.test(handler),
  `${HANDLER}: 不许用会创建会话的 getMaestroAgent —— 没有 pi 会话就是「没有上下文可压」,` +
    '开一个新会话来凑候选批等于给模型压一批它从没见过的上下文'
)

// ── 5. no-usage 与「不用压」不许混 ──────────────────────────────────────────────────────
ok(
  /ledgerHit[\s\S]{0,120}reason: 'no-usage'/.test(handler),
  `${HANDLER}: 账本读不到必须报 no-usage,不能报成 under-threshold —— ` +
    '前者该让调用方退回本地估算,后者该什么都不做,两者后果相反'
)

// ── 6. cutPoint 不要求登录 ──────────────────────────────────────────────────────────────
const cutBody = handler.slice(handler.indexOf('async cutPoint('))
ok(
  cutBody.length > 0 && !/resolveTarget\(\)/.test(cutBody),
  `${HANDLER}: cutPoint 不该走 resolveTarget —— 那会把「该在哪切」和「能不能摘要」绑成一件事,` +
    '于是没登录连切点都算不出来'
)

if (fail.length) {
  console.error('[check-compaction-wiring] FAIL')
  for (const message of fail) console.error(`  ✗ ${message}`)
  process.exit(1)
}
console.log('[check-compaction-wiring] ok')
