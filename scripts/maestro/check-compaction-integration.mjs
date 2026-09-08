#!/usr/bin/env node
// ══ 集成守卫 ══ 渲染端的压缩入口**真的走 main 那条路**,不是各自单测通。
//
// 为什么按符号表验而不是跑一遍:换实现最常见的假动作是「旧函数留着没人调」或「新入口只是包了一层
// 旧逻辑」—— 两者从一次运行里都看不出来,从符号表能看出来。cowork 的
// `check-behavior-compaction-integration.mjs` 是同一条思路。
//
// 五条判据,每一条对应一个已经想清楚的决定:
//   1. 摘要**主路径**是跨进程的 `compaction.compact`,不是渲染端自己的 `buildCompactSummary`;
//   2. 真 usage 是**否决票**:渲染端启发式先说话,只有 `under-threshold` 拦得下来;
//   3. `buildCompactSummary` 只作为**兜底**存在(它对补水仍然有用),不许回到主路径;
//   4. `compressedContext` **照样写** —— 它是重启后恢复历史的唯一来源,entry 树压缩对此无帮助;
//   5. `compressed` 标**不按 `applied` 门控**(与 cowork 一致),偏差靠占位文案可见。
//
// 设计依据:`areas/agent-runtime/agent-design-parity.md` 裁决一「B renderer 侧改道」。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const STORE = 'src/renderer/maestro/control/src/store/message.store.ts'
const store = readFileSync(join(root, STORE), 'utf8')
const fail = []
const ok = (condition, message) => {
  if (!condition) fail.push(message)
}

/** `compactSessionIfNeeded` 的函数体 —— 判据只看它,别被同名符号在别处的出现骗到。 */
const bodyOf = (name) => {
  const at = store.indexOf(`async ${name}(`)
  if (at < 0) return ''
  const end = store.indexOf('\n  }', at)
  return end < 0 ? store.slice(at) : store.slice(at, end)
}
const entry = bodyOf('compactSessionIfNeeded')
ok(entry.length > 0, `${STORE}: 找不到 compactSessionIfNeeded —— 判据失效了,先修判据`)

// ── 1. emitter 存在,且字符串是 handler 的类名 ─────────────────────────────────────────────
ok(
  /createXpcRendererEmitter<MaestroCompactionApi>\('CompactionHandler'\)/.test(store),
  `${STORE}: 必须用 createXpcRendererEmitter<MaestroCompactionApi>('CompactionHandler') —— ` +
    '字符串是 main 侧 handler 的**类名**,写错只会在运行期炸'
)

// ── 2. 摘要主路径跨进程 ────────────────────────────────────────────────────────────────────
ok(/compaction\.compact\(/.test(store), `${STORE}: 没有调 compaction.compact —— 压缩仍然只在渲染端做`)
ok(
  /compaction\.compact\([\s\S]{0,400}?sessionId/.test(store),
  `${STORE}: compact 必须带 sessionId —— main 靠它找到**这个会话已存在的** pi entry 树`
)
// 主路径不许把消息清单交过去:候选批是 main 自己的 entry 树(渲染端的 chat 消息永远没有工具返回正文)
ok(
  !/compaction\.compact\([\s\S]{0,400}?messages:/.test(store),
  `${STORE}: 不许把消息清单交给 compact —— 候选批是 main 自己的 pi entry 树,` +
    '拿渲染端消息当候选批会让那套三层兜底永远休眠'
)

// ── 3. 真 usage 是否决票,不是主触发 ───────────────────────────────────────────────────────
ok(/compaction\.shouldCompact\(/.test(store), `${STORE}: 没有问 main 的 shouldCompact —— 触发线仍然只有渲染端估算`)
ok(
  /reply\.shouldCompact \|\| reply\.reason !== 'under-threshold'/.test(store),
  `${STORE}: 否决语义写错了。**只有 under-threshold 拦得下来** —— no-usage(账本里还没这个会话)` +
    '与跨进程异常都必须放行,否则一个还没跑过一轮的会话永远压不了'
)
ok(
  /if \(!session\.contextUsage\.compressionTriggered\) return false[\s\S]{0,400}?confirmRealUsage/.test(entry),
  `${STORE}: 次序错了 —— 渲染端启发式必须先说话,真 usage 只做否决。` +
    '反过来会把渲染端的显示与它自己的决定拆成两套口径'
)

// ── 4. 兜底只能是兜底 ──────────────────────────────────────────────────────────────────────
ok(
  !/buildCompactSummary\(/.test(entry),
  `${STORE}: compactSessionIfNeeded 直接调了 buildCompactSummary —— 那是兜底,不是主路径。` +
    '主路径必须经 requestMainCompaction 走 main'
)
ok(
  /requestMainCompaction[\s\S]{0,1800}?buildCompactSummary\(/.test(store),
  `${STORE}: requestMainCompaction 里没有 buildCompactSummary 兜底 —— ` +
    '摘要失败时补水通路会拿到一份陈旧摘要,而那是重启后恢复历史的唯一来源'
)

// ── 5. 补水通路不许被砍 ────────────────────────────────────────────────────────────────────
ok(
  /compressedContext: compactSummary/.test(entry),
  `${STORE}: 不再写 detail.compressedContext —— 那会砍掉重启后的恢复通路。` +
    'entry 树压缩对补水一点帮助都没有(新会话的树是空的)'
)

// ── 6. `compressed` 标不按 applied 门控(与 cowork 一致) ──────────────────────────────────
ok(
  !/if \(outcome\.applied\)\s*\{[\s\S]{0,200}?message\.compressed = true/.test(entry),
  `${STORE}: 把 compressed 标门控在 applied 上了。与 cowork 不一致,而且代价是真的:` +
    'applied:false 通常是永久失败(pi 挪走了 appendCompaction),门控会让它每轮重压、每次花一次模型钱。' +
    '兜底是 pi 自己的 auto-compaction(两边 piRuntimeAdapter.ts:188 都显式开着)'
)
ok(
  /COMPACT_NOT_APPLIED_CONTENT/.test(store),
  `${STORE}: 偏差必须**可见** —— applied:false 时占位文案要照实说没落回会话,` +
    '不许拿 "Compacting complete." 冒充'
)

if (fail.length) {
  console.error('[check-compaction-integration] FAIL')
  for (const message of fail) console.error(`  ✗ ${message}`)
  process.exit(1)
}
console.log('[check-compaction-integration] ok')
