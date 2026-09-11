import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `<agentDir>/settings.json` 里那三个压缩参数的**唯一写入点**。
 *
 * Electron-free(与同目录的 `piAgentDir.service.ts` 同一分工):这里值得测的是"算出什么数"和
 * "合并时动了谁",两者一旦伸手去拿 `app.getPath()` 就没法测了。Electron 那半在 `llmPaths.ts`。
 *
 * ## 为什么必须有这个文件
 *
 * bl 里**两套压缩同时活着**,各有各的触发线:
 *
 * | 驱动 | reserve 从哪来 | 272,000 窗口下触发线 |
 * |---|---|---|
 * | 我们自己的(renderer 账本 → `compaction.handler.ts`) | 每模型的 `compressionRemainingPercent` | 按比例 |
 * | pi 自带 auto-compaction | `settings.json` 的 `compaction.reserveTokens` | **缺省 16384 ⇒ 255,616(94%)** |
 *
 * 第二行是问题所在:pi 那个缺省值是**固定 token 数**,不随窗口缩放。实测(2026-09-11)两个
 * edition 的 `settings.json` 都只写了 `compaction.enabled`,于是 pi 在 **94%** 才动手 ——
 * 一个大 tool 结果就能在两次检查之间把窗口冲爆。没人写过这个文件,它是手改/CLI 留下的。
 *
 * 所以这里把同一个比例**同时**落到 pi 那一侧,让两条触发线口径一致(我们的先到,pi 只兜底)。
 *
 * ## 数从哪来
 *
 * Ral 2026-09-11 先给了一组固定值(「上下文超过 220k 就触发压缩」「reserve 近期 40k」),
 * 随后改口「还是按比例来吧,reserved token 数是 20%,summary 是 reserved tokens 的 0.8」。
 * 两者是同一组数 —— 他那组固定值就是按 272,000 窗口算的,比例能原样复现:
 *
 * | 他说的 | 比例 | 272,000 下 |
 * |---|---|---|
 * | 触发 > 220k | reserve **20%** | 272,000 − 54,400 = **217,600** |
 * | reserve 近期 40k | keepRecent **20%**(他后来改的口径) | **54,400** |
 *
 * `summary` 那条**不用我们写** —— pi 自己就是 `min(floor(0.8 × reserveTokens), model.maxTokens)`
 * (`pi-agent-core/dist/harness/compaction/compaction.js:380`),正是他要的 0.8。实测这几个模型
 * `maxTokens = 128,000`,远大于 0.8 × 54,400 = 43,520,所以**那个夹子不生效**,预算就是 43,520。
 * (他最初说的「16k summary 预算」是固定值那一版的,比例化之后自然被 43,520 取代。)
 *
 * ## 合并规则
 *
 * - **三个压缩参数每次照算出来的值写** —— 它们是**随模型窗口推导**出来的,不是用户偏好。
 *   用户的旋钮是每模型的 `compressionRemainingPercent`(设置面板里那个),它是这里的输入。
 * - **其余键一个都不碰**(`httpProxy` / `steeringMode` / `theme` / …)。实测盘上那两个文件就带着
 *   `httpProxy` 和 `steeringMode`,整份覆盖等于把用户的代理配置抹掉。
 * - 文件不存在 / 读不出 / JSON 坏了 ⇒ 从 `{}` 起,**不抛**。压缩参数没写成不该让应用起不来;
 *   最坏情况是退回 pi 缺省,和今天一样。
 * - **值没变就不落盘**。启动 + 每次取配置都会调到这里,无条件写会把 mtime 搅成噪音。
 */

/** pi 的 `Settings.compaction`(`settings-manager.d.ts`)。只声明我们写的那三个。 */
export interface PiCompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

/**
 * 受保护尾部占窗口的比例 —— 压缩后**逐字保留**的最近上下文。
 *
 * **20%**(Ral 2026-09-11 定:「确认 keepRecentTokens 取窗口的 20%」)。272,000 ⇒ 54,400。
 * 我先按他早先那句「reserve 近期 40k」反推成 15%,他否掉了 —— 取 20%,与触发余量同一档。
 *
 * 写成比例而不是固定值,是因为同一个应用还会连 128,000 窗口的模型(`gpt-5.3-codex-spark`);
 * 固定 54,400 在它上面占 43%,和 20% 的触发余量加起来超过六成,压缩会变得既频繁又压不动。
 *
 * ⚠ reserve 20% + keepRecent 20% 合计占掉窗口的 40%:触发时窗口里已有 80%,其中最近 20%
 * 逐字留下,只有中间那 60% 进摘要。这是他要的口径,不是推导出来的。
 */
export const COMPACTION_KEEP_RECENT_RATIO = 0.2;

/** pi 在 `reserveTokens` 缺省时用的值 —— 固定 16384,不随窗口缩放。这里只用来解释差距。 */
export const PI_DEFAULT_RESERVE_TOKENS = 16384;

/**
 * 由窗口 + 余量百分比算出 pi 要的三个数。
 *
 * `remainingPercent` 就是设置面板里每模型的 `compressionRemainingPercent`(缺省 20)。
 * 两个下限不是防御性代码,是真会发生:窗口解析不到时上游传 0,而 `reserveTokens: 0` 会让
 * pi 的判据变成 `used > window` —— 等于**永不压缩直到溢出**,正是最该避免的那个状态。
 */
export const compactionSettingsFor = (params: {
  contextWindowTokens: number;
  remainingPercent: number;
}): PiCompactionSettings => {
  const window = Math.max(0, Math.floor(params.contextWindowTokens || 0));
  const percent = Math.min(90, Math.max(1, Math.floor(params.remainingPercent || 0)));
  return {
    enabled: true,
    reserveTokens: Math.max(1024, Math.floor((window * percent) / 100)),
    keepRecentTokens: Math.max(1024, Math.floor(window * COMPACTION_KEEP_RECENT_RATIO))
  };
};

/** 解析一份 `settings.json`;缺失/坏了都回 `{}`,理由见文件头「合并规则」。 */
const parseSettings = (raw: string | null): Record<string, unknown> => {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

/**
 * 把三个压缩参数并进一份既有设置,返回要落盘的文本;`changed:false` 表示不用写。
 *
 * 导出是为了能脱离文件系统测「只动 compaction、别的键原样」这一条。
 */
export const mergeCompactionSettings = (
  raw: string | null,
  compaction: PiCompactionSettings
): { text: string; changed: boolean } => {
  const settings = parseSettings(raw);
  const previous = settings.compaction;
  const merged = {
    ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}),
    ...compaction
  };
  const next = { ...settings, compaction: merged };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  return { text, changed: text !== raw };
};

export interface PiCompactionSyncResult extends PiCompactionSettings {
  path: string;
  /** 真落盘了吗。`false` = 值与盘上一致(或写失败,见 `error`)。 */
  written: boolean;
  error?: string;
}

/**
 * 算 → 合并 → 落盘(变了才写)。
 *
 * 写用 tmp + rename:pi 在会话创建时同步读这个文件,读到半截的 JSON 会让它整份设置退回缺省 ——
 * 那正好是这个模块要修的毛病,不能由它自己制造。
 */
export const syncPiCompactionSettings = (params: {
  agentDir: string;
  contextWindowTokens: number;
  remainingPercent: number;
}): PiCompactionSyncResult => {
  const path = join(params.agentDir, 'settings.json');
  const compaction = compactionSettingsFor(params);
  const raw = (() => {
    try {
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    } catch {
      return null;
    }
  })();
  const { text, changed } = mergeCompactionSettings(raw, compaction);
  if (!changed) return { ...compaction, path, written: false };
  try {
    mkdirSync(params.agentDir, { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, path);
    return { ...compaction, path, written: true };
  } catch (error) {
    return {
      ...compaction,
      path,
      written: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};
