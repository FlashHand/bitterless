import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 每个会话一份**用户原话的完整历史**:`<userData>/chain/<sessionId>.jsonl`。
 *
 * Ral 2026-09-11 定的形态:
 *  · 上下文里留存的用户原话给 **10% 的 context window** 预算;
 *  · 每个会话创建后就有对应文件,**路径从 newchat 起就注入提示词**(一开始文件是空的);
 *  · 每条要带**发消息时间、当时的 workspace、当时开着的页面**;
 *  · 超出预算的更早原话由文件承载,「固化到文件的」与「处于提示词的」**衔接、不重复、不遗漏**。
 *
 * ## 为什么整条归 main,渲染端退出
 *
 * 上一版的链由渲染端用 `session.messages` 建,而渲染端存的是**用户敲的原文** ——
 * main 发出去的却是长粘贴换过的**引用**。两份不一致的直接后果:一条 20 万字符的粘贴
 * 发送时省掉、第一次压缩时被链原样注入回来,长粘贴转文件形同虚设。
 *
 * 现在 main 写进 jsonl 的**就是它真正发出去的那一份**,那类矛盾从根上不存在。
 * 顺带三样都白拿:顺序、元数据(时间/workspace/tab 只有 main 知道)、跨重启的持久化。
 *
 * ## 「不重复、不遗漏」怎么保证
 *
 * 文件是**发送即追加的全量**,提示词里的链是它的**尾巴**。给模型的那段话点明边界:
 * 「第 1–120 条只在文件里;第 121–156 条已在下方逐字引用,不必去读」。
 * 于是**模型需要读的部分**零重复零遗漏。
 *
 * ⚠ 与 Ral 字面要求的一处偏离:他说文件里只放"被挤出去的"。那样做在重启后会出现真空洞 ——
 * 那批"还在提示词里、尚未固化"的记录既不在文件也不在内存。全量追加把空洞这一类可能性直接消掉,
 * 代价只是文件里多存了已经被引用的那几条(**不占上下文**)。已向他说明。
 *
 * ## 为什么是 jsonl
 *
 * Ral 指定。而且对这个用途是对的:**追加是 O(1),不用重写**;一行一条,读尾巴不必解析整份;
 * 结构化字段(时间/workspace/tab)不用自己发明分隔符,也不会被正文里的 `---` 之类撞坏。
 */

/** `<userData>` 下的目录名。 */
export const USER_CHAIN_DIR_NAME = 'chain';

/**
 * 上下文里留给用户原话的比例。Ral 2026-09-11:「上下文留存的用户原话给 10% 的 context window 预算」。
 *
 * 与压缩那两个比例是同一族(`piCompactionSettings.service.ts`:reserve 20% / keepRecent 20%)。
 * 272,000 窗口下 = 27,200 token。
 */
export const USER_CHAIN_WINDOW_RATIO = 0.1;

/** 一条记录。字段名短是因为它会被写很多遍,且模型读得懂。 */
export interface UserChainRecord {
  /** 序号,从 1 开始 —— 给模型报「第几条」用,也是边界指令的坐标。 */
  n: number;
  /** 发送时刻(本地可读形态,与 D1 同一个串)。 */
  at: string;
  /** 当时的 workspace 绝对路径;没选时为空串。 */
  ws: string;
  /** 当时激活的页面/文件/miniapp 的一行描述;没有时为空串。 */
  tab: string;
  /** **main 真正发出去的那一份文本**(长粘贴已换成引用)。 */
  text: string;
}

/** 估 token:英文约 4 字符/token,中文更少 —— 所以这是保守估计(宁可少放几条)。 */
const estimateTokens = (text: string): number => Math.ceil((text || '').length / 4);

/** 会话 id 里的路径字符必须先洗掉,否则 `/` 会让写入落到子目录或直接 ENOENT。 */
export const chainFileName = (sessionId: string): string =>
  `${(sessionId || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)}.jsonl`;

export const chainFilePath = (dir: string, sessionId: string): string => join(dir, chainFileName(sessionId));

/**
 * 会话建立时就把文件准备好(空文件),并返回绝对路径。
 *
 * **空文件而不是"等第一条消息再建"**:路径从 newchat 起就在提示词里,模型随时可能去读它。
 * 一个存在的空文件读出来是空,一个不存在的文件读出来是错误 —— 后者会让模型以为自己用错了工具。
 */
export const ensureSessionChainFile = (dir: string, sessionId: string): string => {
  const path = chainFilePath(dir, sessionId);
  try {
    mkdirSync(dir, { recursive: true });
    if (!existsSync(path)) writeFileSync(path, '', { encoding: 'utf8', mode: 0o600 });
  } catch {
    // 建不出来不该挡住发消息 —— 提示词里那行路径会照常写,模型去读会拿到错误,
    // 那比"整个回合失败"轻得多。
  }
  return path;
};

/** 读全量记录。文件缺失/坏行都当作"没有这条",不抛。 */
export const readChainRecords = (path: string): UserChainRecord[] => {
  let raw = '';
  try {
    raw = existsSync(path) ? readFileSync(path, 'utf8') : '';
  } catch {
    return [];
  }
  const out: UserChainRecord[] = [];
  for (const line of raw.split('\n')) {
    const text = line.trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text) as Partial<UserChainRecord>;
      if (typeof parsed.text === 'string') {
        out.push({
          n: Number(parsed.n) || out.length + 1,
          at: String(parsed.at || ''),
          ws: String(parsed.ws || ''),
          tab: String(parsed.tab || ''),
          text: parsed.text
        });
      }
    } catch {
      // 坏行跳过。一行坏掉不该让整份历史不可用 —— 那正是 jsonl 相对单个 JSON 的好处。
    }
  }
  return out;
};

/**
 * 追加一条。返回写入后的记录(含序号);写失败返回 `null`,调用方只记日志。
 *
 * 序号按**文件现有行数**推,不靠内存计数器 —— 重启后仍然连续,也不会因为两条路径
 * 各自计数而错位。
 */
export const appendUserChainRecord = (
  path: string,
  record: Omit<UserChainRecord, 'n'>
): UserChainRecord | null => {
  const n = readChainRecords(path).length + 1;
  const full: UserChainRecord = { n, ...record };
  try {
    appendFileSync(path, `${JSON.stringify(full)}\n`, { encoding: 'utf8', mode: 0o600 });
    return full;
  } catch {
    return null;
  }
};

export interface UserChainProjection {
  /** 进提示词的那些,**从老到新**。 */
  quoted: UserChainRecord[];
  /** 只在文件里的条数(即 `quoted[0].n - 1`)。 */
  fileOnlyCount: number;
  total: number;
  tokens: number;
  budgetTokens: number;
}

/**
 * 取尾巴 —— 预算内**最新的那些**。
 *
 * 倒着装:最新的优先。最新一条自己就超预算时**留它、逐字、越预算**,不产出空链 ——
 * 空链等于这一刻上下文里没有任何用户意图,比越预算严重得多。
 */
export const projectUserChain = (records: UserChainRecord[], budgetTokens: number): UserChainProjection => {
  const budget = Math.max(1, Math.floor(budgetTokens));
  const quoted: UserChainRecord[] = [];
  let tokens = 0;
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const cost = estimateTokens(records[i].text) + 24; // 24 ≈ 那三行元数据的开销
    if (quoted.length && tokens + cost > budget) break;
    quoted.unshift(records[i]);
    tokens += cost;
  }
  return {
    quoted,
    fileOnlyCount: quoted.length ? quoted[0].n - 1 : records.length,
    total: records.length,
    tokens,
    budgetTokens: budget
  };
};

/**
 * 渲染成压缩后重新追加的那段正文。空历史返回空串(调用方据此不落 entry)。
 *
 * **边界那句话是这段的承重点**:没有它,模型不知道文件里哪些是它已经看过的,
 * 于是要么整份重读(浪费上下文,正是本机制要省的),要么干脆不读(那文件就白存了)。
 */
export const renderUserChainBlock = (projection: UserChainProjection, filePath: string): string => {
  if (!projection.total) return '';
  const head = [
    '## Verbatim user messages (exact words, oldest → newest)',
    '',
    `Full history of this session's user messages: ${filePath}`
  ];
  if (projection.fileOnlyCount > 0) {
    head.push(
      `Messages #1–#${projection.fileOnlyCount} are ONLY in that file — read it with the \`read\` tool when you need them.`,
      `Messages #${projection.fileOnlyCount + 1}–#${projection.total} are quoted in full below; do NOT re-read those from the file.`
    );
  } else {
    head.push(`All ${projection.total} message(s) are quoted in full below; the file adds nothing you do not already have.`);
  }
  const body = projection.quoted.map((record) => {
    const meta = [`#${record.n}`, record.at, record.ws ? `workspace: ${record.ws}` : 'workspace: none', record.tab || 'tab: none']
      .filter(Boolean)
      .join(' · ');
    return `[${meta}]\n${record.text}`;
  });
  return `${head.join('\n')}\n\n${body.join('\n\n---\n\n')}`;
};

/**
 * 表 3 / C 那一行 —— **会话级、路径固定**,从 newchat 起就在。
 *
 * 归 C 而不是 D:它在一个会话内不变,每轮重拼只是因为我们今天还没有独立的 C 层落点。
 * 写成一行而不是一段:它是坐标,不是内容。
 */
export const renderChainPathLine = (filePath: string): string =>
  `- Your verbatim user-message history for this session (JSONL, one message per line): ${filePath}`;
