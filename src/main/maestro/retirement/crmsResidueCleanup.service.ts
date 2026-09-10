import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * AI-CRMS 退役之后仍然留在盘上的凭据残留 —— 「删哪些键、删哪些文件」的决策逻辑。
 *
 * Sunset: 2026-12-31 — 见 docs/features/maestro-crms-retirement.md #6.9
 *
 * 为什么需要它:**删 writer 不会删数据**。pi provider 的写入方、Micromeet CLI 凭据的写入方
 * 都随退役一起删了,所以这些文件从此再没有任何代码会碰 —— 不主动清一次,盘上就永久留着一枚
 * 可用的 CRMS JWT,与「bl 的 Maestro 不能包含 crms 的东西」这条决定直接矛盾。
 *
 * Electron-free on purpose,理由同 `piAgentDir.service.ts`:值得测试的正是这里的决策,而这个
 * 模块一旦伸手去拿 `app.getPath()` 就都不可测了。Electron 绑定在 `crmsResidueCleanup.ts`。
 *
 * 不在这里处理的一项(#6.5):config 表里 `ai-crms/qwen3.7-plus` 那条压缩偏好会永远留着。
 * 它不含凭据,`applyCompressionPrefs` 每次白跑一遍而已 —— 记一句就够,不值得多一段迁移。
 */

/** pi 的 provider id。`models.json` 与 `models-store.json` 都拿它当键。 */
export const CRMS_PI_PROVIDER = 'ai-crms';

/** Micromeet CLI 的 CRMS 凭据(AES-GCM 信封)。 */
export const CRMS_CLI_CREDENTIAL_FILE = 'crms.json';
/** crms 与 sys 两个 realm 共用的 32 字节密钥。 */
export const CLI_CREDENTIAL_KEY_FILE = '.credential-key-v2';
/** Sys realm 的凭据。本次退役明确不动它。 */
export const CLI_SYS_CREDENTIAL_FILE = 'sys.json';

export interface CrmsResiduePaths {
  /**
   * pi 写的 `models.json`(provider 收在 `providers` 映射下)—— **新旧两个目录都要**。
   *
   * 2026-09-08 那次 pi 目录迁移是 **copy 而不是 move**(`migratePiStateFiles` 用 `copyFileSync`,
   * 它自己的注释写明「the old dir is cheap to leave behind」),所以 legacy 目录里那份同名副本
   * 原样留在盘上。而它的 writer 已随本次退役删除 —— 只清新目录的话,那份 `providers['ai-crms']`
   * 明文 JWT **从此再没有任何代码碰得到**,而 marker 一旦写下连重试的机会都没有。
   */
  piModelsFiles: string[];
  /** pi 的 ModelRuntime 写在它旁边的 `models-store.json`:provider 直接做顶层键。同样新旧都要。 */
  piModelsStoreFiles: string[];
  /** 两个发布通道各自的 CLI 凭据目录 —— 一台机器上可能先后装过两个通道。 */
  cliCredentialDirs: string[];
}

export const resolveCrmsResiduePaths = (input: {
  /** `maestroModelsPath()`。`models-store.json` 由它同目录派生,和 pi 自己的派生方式一致。 */
  piModelsFile: string;
  /** `resolveMaestroPiPaths().legacyDir` —— 迁移前那个目录,里面是 copy 留下的同名副本。 */
  legacyPiDir: string;
  appUserDataPath: string;
  homeDirectory: string;
}): CrmsResiduePaths => ({
  piModelsFiles: [input.piModelsFile, join(input.legacyPiDir, 'models.json')],
  piModelsStoreFiles: [
    join(dirname(input.piModelsFile), 'models-store.json'),
    join(input.legacyPiDir, 'models-store.json')
  ],
  cliCredentialDirs: [
    // Stable 通道:CLI 的默认 home,同时也是用户自己那套 micromeet CLI 的 home。
    join(input.homeDirectory, '.micromeet', 'credentials'),
    // Preview 通道:CLI 被隔离到 userData 下,免得和上面那份抢同一批凭据。
    join(input.appUserDataPath, 'cowork', 'cli', 'credentials')
  ]
});

type ProviderLayout = 'providers-map' | 'top-level';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * 从一份 pi 模型文档里摘掉 ai-crms 那个 provider。
 *
 * @returns 改写后的文档;无需改写(不是对象 / 本来就没这个 provider)时返回 `null`,调用方据此
 * 决定要不要落盘 —— 免得每次启动都把两个文件重写一遍。
 */
export const stripCrmsProvider = (doc: unknown, layout: ProviderLayout): Record<string, unknown> | null => {
  const root = asRecord(doc);
  if (!root) return null;
  const holder = layout === 'top-level' ? root : asRecord(root.providers);
  if (!holder || !(CRMS_PI_PROVIDER in holder)) return null;
  delete holder[CRMS_PI_PROVIDER];
  return root;
};

/**
 * 改写两份 pi 模型文档。
 *
 * @returns 实际改写过的文件路径 —— 没有残留时是空数组。
 */
export const stripCrmsProviderFromPiModels = (
  paths: Pick<CrmsResiduePaths, 'piModelsFiles' | 'piModelsStoreFiles'>
): string[] => {
  const rewritten: string[] = [];
  const targets: [string, ProviderLayout][] = [
    ...paths.piModelsFiles.map((file): [string, ProviderLayout] => [file, 'providers-map']),
    ...paths.piModelsStoreFiles.map((file): [string, ProviderLayout] => [file, 'top-level'])
  ];
  for (const [file, layout] of targets) {
    if (!existsSync(file)) continue;
    // **每个文件各自 try/catch。** pi 自己异常退出时留下半截 JSON 并不罕见,而一份坏文件若让
    // 整个函数抛出,上层就归为 failure、marker 永不写入 —— 于是每次启动都重跑、每次都在同一份
    // 坏文件上再抛一次,而**另一份本来清得掉的文档也一起被拖着不清**。跳过坏的那份即可。
    try {
      const next = stripCrmsProvider(JSON.parse(readFileSync(file, 'utf8')), layout);
      if (!next) continue;
      writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
      rewritten.push(file);
    } catch {
      continue;
    }
  }
  return rewritten;
};

export interface CliCredentialRemovalPlan {
  /** 要 unlink 的绝对路径。 */
  files: string[];
  /** 清完之后 `credentials/` 空了,可以一并删。 */
  removeDirectory: boolean;
}

/**
 * 一个 CLI 凭据目录该删什么。
 *
 * 与契约 #6.2 的一处偏离,以及为什么:契约要求把 `.credential-key-v2` 一并删,但同一段又写着
 * 「不要动 sys.json」。这两条在目录里还留着 sys.json 时是冲突的 —— 那把密钥是 crms 与 sys
 * **共用**的,删掉它 sys 凭据就再也解不开,而 `~/.micromeet` 是用户自己那套 CLI 的 home,
 * 不只是 bl 写过的地方。所以密钥只在没有 sys.json 时删;crms.json 一走,它就不再能解开任何
 * CRMS 凭据,留着不违背退役的决定。
 */
export const planCliCredentialRemoval = (input: {
  directory: string;
  entries: string[];
}): CliCredentialRemovalPlan => {
  const remaining = new Set(input.entries);
  const names: string[] = [];
  if (remaining.has(CRMS_CLI_CREDENTIAL_FILE)) names.push(CRMS_CLI_CREDENTIAL_FILE);
  if (remaining.has(CLI_CREDENTIAL_KEY_FILE) && !remaining.has(CLI_SYS_CREDENTIAL_FILE)) {
    names.push(CLI_CREDENTIAL_KEY_FILE);
  }
  for (const name of names) remaining.delete(name);
  return {
    files: names.map((name) => join(input.directory, name)),
    removeDirectory: names.length > 0 && remaining.size === 0
  };
};

/**
 * 清掉每个通道的 CLI 凭据。
 *
 * @returns 实际删掉的文件路径。
 */
export const removeCrmsCliCredentials = (directories: string[]): string[] => {
  const removed: string[] = [];
  for (const directory of directories) {
    if (!existsSync(directory)) continue;
    const plan = planCliCredentialRemoval({ directory, entries: readdirSync(directory) });
    for (const file of plan.files) {
      rmSync(file, { force: true });
      removed.push(file);
    }
    if (plan.removeDirectory) rmdirSync(directory);
  }
  return removed;
};
