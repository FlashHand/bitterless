/* eslint-disable @typescript-eslint/explicit-function-return-type */
/*
 * `<agentDir>/settings.json` 的压缩参数 —— 钉住"pi 自带的那条触发线不再吃它的固定缺省"。
 *
 * 为什么需要守卫:pi 的 `reserveTokens` 缺省是**固定 16384**,不随窗口缩放
 * (`pi-agent-core/dist/harness/compaction/compaction.js:77`)。272,000 窗口下那是 94% 才动手。
 * 实测 2026-09-11,两个 edition 盘上的 `settings.json` 都只写了 `compaction.enabled`,
 * 也就是说这条线一直是 pi 的缺省 —— 没有任何代码写过这个文件。回退到那个状态不会报错、
 * 不会 typecheck 失败、UI 上也看不出来,只会在某次长会话里突然溢出。所以钉在这里。
 *
 * 跑真源码(ts → CJS → new Function),不复述实现里的公式。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)

// 解析 `@maestro-*` 别名。`llmModels.ts` 有**值导入** `@maestro-shared/coach.api`
// (`defaultLlmEffort`);2026-09-11 之前那里只有 type 导入、会被转译擦掉,所以旧版加载器
// 不解析别名也能跑 —— 那次把它从 type 改成值导入,守卫立刻以 `Cannot find module` 整条挂掉,
// 表现和一次真实回归一模一样。别名解析是这条守卫的前提,不是可选项。
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

const svc = load('src/main/maestro/llm/piCompactionSettings.service.ts')
const models = load('src/main/maestro/llm/llmModels.ts')

// —— 1. 比例本身 ——————————————————————————————————————————————————————————
// Ral 2026-09-11 先给固定值(触发 >220k、reserve 近期 40k),再改口按比例。两者是同一组数,
// 因为他那组是按 272,000 窗口算的。这条断言就是那个等价关系,别把它改成复述常量。
assertOk(models.DEFAULT_COMPRESSION_REMAINING_PERCENT === 20, 'reserve 必须是窗口的 20%(Ral 2026-09-11)')

const REAL_WINDOW = 272_000 // gpt-6-astra / gpt-5.6-* / gpt-5.4* 的实测窗口
const real = svc.compactionSettingsFor({
  contextWindowTokens: REAL_WINDOW,
  remainingPercent: models.DEFAULT_COMPRESSION_REMAINING_PERCENT
})
assertOk(real.enabled === true, 'compaction 必须是开着的')
assertOk(
  REAL_WINDOW - real.reserveTokens === 217_600,
  `272,000 窗口下触发线应为 217,600(≈他说的「超过 220k」),实得 ${REAL_WINDOW - real.reserveTokens}`
)
assertOk(real.keepRecentTokens === 54_400, `keepRecent 应为 54,400(窗口 20%,Ral 2026-09-11 定),实得 ${real.keepRecentTokens}`)

// pi 缺省会让触发线落在 94% —— 这条比较存在的意义是说明"为什么必须写这个文件"。
assertOk(
  REAL_WINDOW - real.reserveTokens < REAL_WINDOW - svc.PI_DEFAULT_RESERVE_TOKENS,
  '我们的触发线必须早于 pi 的固定缺省,否则写这个文件没有意义'
)

// 窗口解析不到时上游传 0。`reserveTokens: 0` 会让 pi 的判据变成 `used > window` ——
// 永不压缩直到溢出,正是最该避免的状态。
const degraded = svc.compactionSettingsFor({ contextWindowTokens: 0, remainingPercent: 0 })
assertOk(degraded.reserveTokens > 0 && degraded.keepRecentTokens > 0, '窗口/百分比缺失时不许产出 0(那等于永不压缩)')

// —— 2. 合并:只动 compaction,别的键原样 ——————————————————————————————————
// 盘上真实文件带着 `httpProxy`(Codex 代理)和 `steeringMode`。整份覆盖等于抹掉用户的代理配置。
const existing = JSON.stringify(
  { schemaVersion: 1, httpProxy: 'http://127.0.0.1:7897', compaction: { enabled: true }, steeringMode: 'one-at-a-time' },
  null,
  2
)
const merged = JSON.parse(svc.mergeCompactionSettings(existing, real).text)
assertOk(merged.httpProxy === 'http://127.0.0.1:7897', '合并必须保留 httpProxy')
assertOk(merged.steeringMode === 'one-at-a-time', '合并必须保留 steeringMode')
assertOk(merged.schemaVersion === 1, '合并必须保留未知键')
assertOk(merged.compaction.reserveTokens === real.reserveTokens, '合并必须写入算出的 reserveTokens')

// 坏 JSON / 空文件不许抛 —— 压缩参数没写成不该让应用起不来。
for (const [label, raw] of [
  ['null', null],
  ['空', ''],
  ['坏 JSON', '{oops'],
  ['数组', '[]']
]) {
  const out = svc.mergeCompactionSettings(raw, real)
  assertOk(JSON.parse(out.text).compaction.reserveTokens === real.reserveTokens, `${label} 输入应退回 {} 而不是抛`)
}

// 值没变就不落盘 —— 启动 + 每次取配置都会调到,无条件写会把 mtime 搅成噪音。
assertOk(svc.mergeCompactionSettings(svc.mergeCompactionSettings(existing, real).text, real).changed === false, '幂等:值没变不该报 changed')

// —— 3. 真落盘 ————————————————————————————————————————————————————————————
const dir = mkdtempSync(join(tmpdir(), 'bl-pi-settings-'))
writeFileSync(join(dir, 'settings.json'), existing)
const first = svc.syncPiCompactionSettings({ agentDir: dir, contextWindowTokens: REAL_WINDOW, remainingPercent: 20 })
assertOk(first.written === true && !first.error, `首次应写盘,实得 written=${first.written} error=${first.error || ''}`)
const onDisk = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
assertOk(onDisk.httpProxy === 'http://127.0.0.1:7897', '落盘后 httpProxy 仍在')
assertOk(onDisk.compaction.keepRecentTokens === 54_400, '落盘后 keepRecentTokens 正确')
assertOk(
  svc.syncPiCompactionSettings({ agentDir: dir, contextWindowTokens: REAL_WINDOW, remainingPercent: 20 }).written === false,
  '第二次同样的值不该再写盘'
)

// 目录不存在时自己建(首启动就是这个情形)。
const fresh = join(mkdtempSync(join(tmpdir(), 'bl-pi-fresh-')), '.pi')
assertOk(
  svc.syncPiCompactionSettings({ agentDir: fresh, contextWindowTokens: REAL_WINDOW, remainingPercent: 20 }).written === true,
  '目录不存在时应自建并写入'
)

// —— 4. 接线:取配置这条路必须调到同步 ————————————————————————————————————
// 挂在 `getLlmConfig()` 上是因为它是换模型 / 改余量 / 启动三件事的共同下游。断开这根线,
// 上面所有断言仍然全绿,而盘上的文件永远不会被写 —— 所以它必须单独钉。
const service = readFileSync(resolve(root, 'src/main/maestro/llm/maestroLlm.service.ts'), 'utf8')
assertOk(service.includes('syncPiCompactionSettings'), 'maestroLlm.service 必须调用 syncPiCompactionSettings')
assertOk(/this\.syncPiCompaction\(target, presets, windows\)/.test(service), 'getLlmConfig 必须在解析出真窗口后同步 pi 压缩参数')
assertOk(
  !/contextWindowTokens:\s*[^\n]*contextLengthK/.test(service),
  'contextLengthK 是四舍五入到 K 的显示值,不能拿它算触发线(272,000 → 266K → 272,384)'
)

if (!process.exitCode) console.log('[check-pi-compaction-settings] ok')
