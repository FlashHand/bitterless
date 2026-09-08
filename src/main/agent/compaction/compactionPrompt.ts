/**
 * ③ 摘要的指令与产物清洗。**纯函数,零 import** —— 守卫脚本要能把它单独 esbuild 出来在 vm 里跑
 * (`scripts/check-behavior-compaction-summary.mjs`,同 `inputBudget.ts` 那一批的做法)。
 *
 * **产物形态沿用 pi 的固定骨架**(契约「③ 摘要 —— 沿用 pi 的固定骨架」· Ral 2026-08-27 选项 A):
 * `## Goal` / `## Constraints & Preferences` / `## Progress`(`### Done` `### In Progress` `### Blocked`)
 * / `## Key Decisions` / `## Next Steps` / `## Critical Context`。**不要求散文** —— 衰减度量按 `## 段`
 * 切、段内按 `- ` 拆条目逐字比对,散文测不出那张留存表,也就永远不知道递归摘要到底损失多少。
 *
 * ⚠ **主摘要那一次 `customInstructions` 一律传 `undefined`**(契约「③ 摘要」的实测定案 · 2026-08-28)。
 * pi 在 `compaction.js:444` 提供的追加点(`Additional focus: …`)我们**不用**。依据是同素材同模型各
 * 8 轮真实压缩的三组对照:A 组(无追加指令)S1→S8 逐字留存 **89%**;B 组(裁剪许可 + 因果要求)
 * **17%**;C 组**只**加一条纯加法的因果要求、一个字的裁剪许可都没给,靶子也确实打中了,
 * 留存照样掉到 **51%**。⇒ 追加任何指令都会稀释基座的 PRESERVE 约束,让模型从**搬运**切换成**重写**,
 * 而重写在递归结构里逐代复利。所以这里**没有**主摘要的指令常量 —— 少了它才是合约状态。
 * (前缀那一次是例外,见 `TURN_PREFIX_CUSTOM_INSTRUCTIONS`:换上去的是 pi 自己的三段骨架,
 *  是「沿用 pi」而不是我们的追加指令。)
 *
 * 契约两条仍要施加的约束(docs/features/cowork-context-compaction.md · docs/plan/tasks/ctx-004.md):
 *   ① **摘要长度不设人为上限** —— `reserveTokens` 用 pi 的默认值,不覆盖(见 `PI_SUMMARY_RESERVE_TOKENS`)。
 *      pi 的 `maxTokens` 是**输出上限**,到顶得到的是 `stop_reason: max_tokens` 截断而不是更短的摘要;
 *      骨架有序,截在 4k 砍掉的正好是尾部的 `## Next Steps` 与 `## Critical Context` ——
 *      恰是「继续干活」最需要的两段。S 的增长改由后续手段控制,不在本任务范围。
 *   ② **不写任何路径** —— 地址由 ④ 清单负责,而且整条 summary 会随 `previousSummary` 回喂给模型,
 *      路径混进去会被逐轮改写。基座写着 `Preserve exact file paths, function names, and error messages.`,
 *      而主摘要这一次**连指令面都没有** ⇒ `stripPaths` 是这条约束**唯一**的闸门,且是确定性的。
 *
 * 「引用用户原话时逐字」**不单列**(契约「两条仍然要施加的约束」下那一句):交给基座的
 * `PRESERVE exact … error messages` 与 ② 用户原话链共同兜住。
 */

/** ② 的兜底替换文本。**自身不含分隔符** —— 否则清洗完的正文还能被路径正则再匹配一次。 */
export const PATH_REDACTION = '[path omitted, see manifest]'

/**
 * ⚠ **主摘要没有追加指令常量,这是刻意的** —— 契约「③ 摘要」定案:那一次 `customInstructions`
 * 一律传 `undefined`。曾经这里有一份 `SUMMARY_CUSTOM_INSTRUCTIONS`(要求沿用基座骨架 + 不写路径),
 * A/B/C 三组实测把它判掉了:哪怕是 C 组那种零裁剪许可的纯加法要求,逐字留存也从 89% 掉到 51%。
 * 骨架本来就由 pi 的基座提示词自己保证(`SUMMARIZATION_PROMPT` 里那句 `Use this EXACT format:`),
 * 不写路径由 `stripPaths` 确定性地保证 —— 两条约束都不再需要指令面。
 *
 * 想加回来之前先跑一组对照(`overmind:areas/agent-runtime/chat/sim/`),别凭直觉改。
 * 守卫 `scripts/check-behavior-compaction-summary.mjs` 钉着「主摘要那次调用的
 * `customInstructions === undefined`」+「常量不许复活」,加回来会立刻红。
 */

/**
 * split turn 前缀的追加指令 —— **前缀用 pi 自己的三段骨架,不是主摘要那六段**。
 *
 * 为什么这里也自带一份指令:pi 的 `generateTurnPrefixSummary` **是模块私有函数,0.79.0 没有导出**
 * (`dist/index.d.ts` 的导出清单里没有它,只在 `compact()` 内部被调用)。而 `compact()` 我们不能用 ——
 * 它会把 `formatFileOperations(readFiles, modifiedFiles)` 追加到摘要末尾,那正是一串路径,和 ② 对撞。
 * 所以前缀摘要由 `generateSummary` + 这份指令复刻。
 *
 * ⚠ **这是唯一一处要替换基座骨架的调用**,而它恰恰仍是「沿用 pi」:pi 的前缀摘要走的是另一个
 * 基座提示词 `TURN_PREFIX_SUMMARIZATION_PROMPT`(`compaction.js:542-555`),本来就是独立的三段
 * `## Original Request` / `## Early Progress` / `## Context for Suffix`;而我们借的
 * `generateSummary` 在 `previousSummary === undefined` 时挂的是六段的 `SUMMARIZATION_PROMPT`。
 * 不替换就会得到一份顶着完整 checkpoint 头的前缀,和主摘要拼起来出现两套 `## Goal`。
 * 三段正文逐字取自 pi 那份常量,只在末尾补上契约 ② 的不写路径。
 */
export const TURN_PREFIX_CUSTOM_INSTRUCTIONS = [
  'IGNORE the section format above — that template is for a full context checkpoint, and this is not one.',
  '',
  'This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.',
  '',
  'Summarize the prefix to provide context for the retained suffix, using EXACTLY these three sections:',
  '',
  '## Original Request',
  '[What did the user ask for in this turn?]',
  '',
  '## Early Progress',
  '- [Key decisions and work done in the prefix]',
  '',
  '## Context for Suffix',
  '- [Information needed to understand the retained recent work]',
  '',
  "Be concise. Focus on what's needed to understand the kept suffix.",
  'Never write a file path, directory name, or filesystem location; this overrides the "Preserve exact file paths" line above. Function names and error messages you SHOULD still keep verbatim.'
].join('\n')

/**
 * 合并分隔符。与 pi `compact()` 的写法逐字一致(`compaction.js:576`)—— 前缀摘要在 pi 里就是这么
 * 缝到主摘要后面的,复刻它是为了万一以后切回 pi 的 `compact()`,拼出来的形状不变。
 */
export const TURN_PREFIX_MERGE_SEPARATOR = '\n\n---\n\n**Turn Context (split turn):**\n\n'

/** 主摘要 + 前缀摘要。任一为空就只留另一个 —— 不留一个空的分隔符头。 */
export const mergeSummaries = (history: string, turnPrefix: string): string => {
  const main = (history || '').trim()
  const prefix = (turnPrefix || '').trim()
  if (!prefix) return main
  if (!main) return prefix
  return `${main}${TURN_PREFIX_MERGE_SEPARATOR}${prefix}`
}

/** URL 不是文件系统地址。浏览器自动化的摘要提到站点是正常的,先摘出来再放回,别被路径正则吃掉。 */
const URL_RE = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s<>"'`)\]}]+/g

/** `C:\a\b` 与 UNC `\\host\share`。 */
const WINDOWS_PATH_RE = /(?:[A-Za-z]:|\\\\)[\\/][^\s<>"'`)\]},;]*/g

/** 至少一个分隔符的 token。是不是路径由 `looksLikePath` 判 —— 正则只负责圈出候选。 */
const SEGMENTED_TOKEN_RE = /(?:@|~|\.{1,2})?\/?(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]*/g

/**
 * cowork 产物与代码树的根目录名。第一段命中就算路径 —— **`out/` 必须被这条抓住**:
 * 它只有一个分隔符、没有扩展名,靠通用启发式判不出来。
 */
const PATH_ROOT_SEGMENTS = new Set([
  'out',
  'docs',
  'src',
  'apps',
  'tmp',
  'dist',
  'node_modules',
  'scripts',
  'skills',
  'recordings',
  'artifacts',
  'workspace',
  'Users',
  'home',
  'var',
  'etc',
  'usr',
  'opt'
])

const PLACEHOLDER_HEAD = '\u0000u'
const PLACEHOLDER_TAIL = '\u0000'

/**
 * 圈出来的 token 到底是不是路径。
 *
 * 判据宁可漏判也不误判 —— 误判会把 `read/write`、`input/output`、`and/or` 这类散文吃成
 * `[path omitted]`,那是把摘要改坏;漏判只是留下一个地址,而 ② 的真实风险是**成规模**地写路径。
 * 四条命中任一即算路径:
 *   · 有明确的路径头(`/` `./` `../` `~/` `@` 盘符);
 *   · 两个以上分隔符(`a/b/c` 这种散文里几乎不出现);
 *   · 末段带扩展名(`x/y.md`);
 *   · 首段是已知的树根(`out/` `docs/` …)。
 */
export const looksLikePath = (token: string): boolean => {
  const value = token || ''
  if (!value) return false
  if (/^(?:[\\/]|\.{1,2}[\\/]|~[\\/]|@|[A-Za-z]:[\\/])/.test(value)) return true
  const separators = (value.match(/[\\/]/g) || []).length
  if (separators >= 2) return true
  if (/\.[A-Za-z0-9]{1,8}$/.test(value)) return true
  const head = value.replace(/^[@~.]+/, '').split(/[\\/]/)[0]
  return PATH_ROOT_SEGMENTS.has(head)
}

/**
 * ② 的确定性闸门:把摘要里的文件系统地址换成 `PATH_REDACTION`。
 *
 * 为什么必须有它:pi 的基座提示词写着「Preserve exact file paths」,`customInstructions` 只能追加。
 * 指令能不能赢是概率问题,而 ② 是不变量 —— 而且这条摘要下一轮会作为 `previousSummary` 回喂,
 * 一次漏进去的路径会被逐轮改写成一个**看起来对、其实早就不存在**的地址。
 *
 * 返回清洗后的正文与命中处数;处数进 `CompactionReply.redactedPaths`,好在日志里看见模型有多不听话。
 */
export const stripPaths = (text: string): { text: string; redacted: number } => {
  const input = text || ''
  if (!input) return { text: '', redacted: 0 }
  const urls: string[] = []
  let redacted = 0
  let masked = input.replace(URL_RE, (match) => {
    urls.push(match)
    return `${PLACEHOLDER_HEAD}${urls.length - 1}${PLACEHOLDER_TAIL}`
  })
  masked = masked.replace(WINDOWS_PATH_RE, () => {
    redacted += 1
    return PATH_REDACTION
  })
  masked = masked.replace(SEGMENTED_TOKEN_RE, (match) => {
    if (!looksLikePath(match)) return match
    redacted += 1
    return PATH_REDACTION
  })
  const restored = masked.replace(/\u0000u(\d+)\u0000/g, (_all, index: string) => urls[Number(index)] ?? '')
  return { text: restored, redacted }
}

/** pi 把 `0.8 × reserveTokens` 当主摘要的 `maxTokens`(`compaction.js:441`)。 */
const PI_SUMMARY_MAX_TOKENS_RATIO = 0.8

/** pi 把 `0.5 × reserveTokens` 当**前缀**摘要的 `maxTokens`(`compaction.js:599`,注释「Smaller budget」)。 */
const PI_TURN_PREFIX_MAX_TOKENS_RATIO = 0.5

/**
 * 交给 pi `generateSummary` 的 `reserveTokens` —— **就是 pi 自己的默认值,我们不覆盖**。
 *
 * 来源:`compaction.js:68` 的 `DEFAULT_COMPACTION_SETTINGS.reserveTokens` 与
 * `settings-manager.js:513` 的 `this.settings.compaction?.reserveTokens ?? 16384`,两处同值。
 * ⇒ 主摘要 `maxTokens = floor(0.8 × 16384) = 13107`(再被 `model.maxTokens` 钳一次)。
 *
 * 早先这里传 5120 反算出 4k 硬顶,已作废:`maxTokens` 是**输出上限**,顶到了得到的是
 * `stop_reason: max_tokens` 截断,而不是一份更短的摘要 —— 骨架有序,截在 4k 砍掉的正好是尾部的
 * `## Next Steps` 与 `## Critical Context`。S 的增长归后续手段,不靠削 `maxTokens`。
 */
export const PI_SUMMARY_RESERVE_TOKENS = 16384

/**
 * 前缀摘要那一次要传的 `reserveTokens`。
 *
 * 换算而不是照传:pi 的 `generateTurnPrefixSummary` 按 `0.5 × R` 取 `maxTokens`,而它未导出,
 * 我们只能借 `generateSummary`(按 `0.8 × R` 取)。把同一个 R 折成 `R × 0.5 / 0.8`,
 * 得到的 `floor(0.8 × 换算值)` 与 pi 的 `floor(0.5 × R)` 相等 —— 16384 ⇒ 10240 ⇒ 8192。
 * **这不是人为上限**,是把 pi 的前缀口径搬到另一个入口上。
 */
export const piReserveForTurnPrefix = (reserveTokens: number): number =>
  Math.max(
    1,
    Math.ceil((Math.max(1, Math.floor(reserveTokens || 0)) * PI_TURN_PREFIX_MAX_TOKENS_RATIO) / PI_SUMMARY_MAX_TOKENS_RATIO)
  )
