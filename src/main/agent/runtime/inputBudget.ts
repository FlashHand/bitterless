// 「这一轮的输入是谁堆起来的」——【上下文账本】。
//
// 为什么必须有它(Ral 2026-08-20,钻探中吃到 `context_length_exceeded`):
// 出事之后我们**什么都定位不了**。pi 的会话用的是 `SessionManager.inMemory()`
// (piRuntimeAdapter.ts:101),对话历史只在内存里 —— 没有 rollout 文件、没有落盘的 message 列表。
// 回合一死,那份"输入原始资料"就随进程消失了,连"哪个工具吃掉了上下文"都无从查证。
//
// 这个账本刻意**不存原文**,只存构成:工具名 → 调用次数 / 累计字节 / 单次最大。
// 理由有两条:
//   ① 原文里有客户业务数据(钻探读的是真站点的响应),落盘要单独决定,不该由一个诊断需求顺手引入;
//   ② 优化 agent 需要的本来就不是原文,而是**分布** —— 哪个工具在涨、涨得多快。
//
// 累计维度是**会话级**而不是回合级:上下文超限是历史堆积的结果,不是某一轮特别大。
// 所以两个数都报:这一轮多少、开局至今多少。
//
// 字节→token 用 2.8 B/token,与 captureSession.types.ts 的 ESTIMATED_BYTES_PER_TOKEN 同一系数
// (本仓自己测的:ASCII JSON 3.05 · 中文 JSON 3.02 · minified JS 3.56 · base64 2.48)。
// 系数一致比"更准"重要 —— 两处不同的估算会让两个界面上的数字对不上,而没人知道该信哪个。

const BYTES_PER_TOKEN = 2.8
/** 明细里最多列几个工具。**超出的必须报出来**,不许静默截断。 */
const TOP_N = 8

interface ToolTally {
  calls: number
  bytes: number
  maxBytes: number
  /** 单次最大的那一笔是谁 —— 拆分方案要落到具体对象上,只知道"哪个工具"还不够动手。 */
  maxSubject: string
}

/**
 * 单笔调用的记录。**只留最大的那些**(MAX_CALLS),因为拆分方案永远是从最大的几笔开始定的。
 *
 * `subject` 是**白名单字段拼出来的短标签**(url / module / name / …),不是整份入参 ——
 * 入参里可能有请求体和客户业务数据,而这是个诊断账本,不该顺手把那些抄进日志。
 */
interface BigCall {
  tool: string
  subject: string
  bytes: number
  turnIndex: number
}

const merge = (into: Map<string, ToolTally>, tool: string, bytes: number, subject: string): void => {
  const prev = into.get(tool) || { calls: 0, bytes: 0, maxBytes: 0, maxSubject: '' }
  prev.calls += 1
  prev.bytes += bytes
  if (bytes > prev.maxBytes) {
    prev.maxBytes = bytes
    prev.maxSubject = subject
  }
  into.set(tool, prev)
}

/** 单笔调用榜的长度。够定拆分方案,又不至于让一条日志变成一页。 */
const MAX_CALLS = 12

/**
 * 从工具入参里取一个**可读、可定位、不泄密**的标签。
 * 白名单取键,拼一小段,截断。入参的其余部分一概不看 —— 里面可能是请求体。
 */
export const subjectOf = (args: unknown): string => {
  if (!args || typeof args !== 'object') return ''
  const a = args as Record<string, unknown>
  const parts: string[] = []
  for (const k of ['url', 'module', 'moduleName', 'name', 'path', 'host', 'siteId', 'formKey', 'ref', 'selector', 'action']) {
    const v = a[k]
    if (typeof v === 'string' && v.trim()) parts.push(`${k}=${v.trim().slice(0, 60)}`)
    else if (typeof v === 'number') parts.push(`${k}=${v}`)
    if (parts.length >= 3) break
  }
  return parts.join(' ').slice(0, 120)
}

class InputBudget {
  /** 本回合。turnStart() 清空。 */
  private turn = new Map<string, ToolTally>()
  /** 本会话累计。**不随回合清空** —— 超限是累积的结果。 */
  private session = new Map<string, ToolTally>()
  private turnIndex = 0
  /** 全会话最大的若干笔调用。这是"该拆什么"最直接的证据。 */
  private bigCalls: BigCall[] = []
  /** 每回合的增量,用来区分「一次尖峰」和「持续累积」—— 两者的拆分方案完全不同。 */
  private perTurnTokens: number[] = []

  /** 当前回合序号 —— modelIoLog 的行要能和账本对上,所以两处用同一个计数。 */
  get turnIndexNow(): number {
    return this.turnIndex
  }

  turnStart(): void {
    if (this.turnIndex > 0) {
      const { bytes } = InputBudget.totals(this.turn)
      this.perTurnTokens.push(Math.round(bytes / BYTES_PER_TOKEN))
      if (this.perTurnTokens.length > 200) this.perTurnTokens.shift()
    }
    this.turn = new Map()
    this.turnIndex += 1
  }

  /** 每个工具结果都过这里。传字节数和一个短标签,**不传内容**。 */
  record(tool: string, bytes: number, subject = ''): void {
    if (!Number.isFinite(bytes) || bytes < 0) return
    merge(this.turn, tool, bytes, subject)
    merge(this.session, tool, bytes, subject)
    // 单笔榜:插入后按大小截断。小笔直接丢,不占内存。
    if (this.bigCalls.length < MAX_CALLS || bytes > this.bigCalls[this.bigCalls.length - 1].bytes) {
      this.bigCalls.push({ tool, subject, bytes, turnIndex: this.turnIndex })
      this.bigCalls.sort((a, b) => b.bytes - a.bytes)
      if (this.bigCalls.length > MAX_CALLS) this.bigCalls.length = MAX_CALLS
    }
  }

  /** 会话重置(freshSession / agent reset)时调用,否则累计数会跨会话串味。 */
  reset(): void {
    this.turn = new Map()
    this.session = new Map()
    this.turnIndex = 0
    this.bigCalls = []
    this.perTurnTokens = []
  }

  private static totals(m: Map<string, ToolTally>): { bytes: number; calls: number } {
    let bytes = 0
    let calls = 0
    for (const t of m.values()) {
      bytes += t.bytes
      calls += t.calls
    }
    return { bytes, calls }
  }

  // 同上:返回类型交给推断,别在两处各写一份字段清单。
  private static top(m: Map<string, ToolTally>) {
    return [...m.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .map(([tool, t]) => ({
        tool,
        calls: t.calls,
        bytes: t.bytes,
        maxBytes: t.maxBytes,
        maxSubject: t.maxSubject,
        tokens: Math.round(t.bytes / BYTES_PER_TOKEN),
        // 均值:峰值大但均值小 = 个别页面特殊(该按页拆);两者都大 = 这个工具本身就该缩(该改产物)。
        meanBytes: Math.round(t.bytes / Math.max(1, t.calls))
      }))
  }

  /**
   * 给日志用的结构化快照。**返回类型交给推断** —— 手写一份签名之后,
   * 每次往报告里加一个字段都要改两处,而漏改的表现是编译报错在一个跟改动无关的地方(刚踩过)。
   */
  report() {
    const build = (m: Map<string, ToolTally>) => {
      const { bytes, calls } = InputBudget.totals(m)
      const all = InputBudget.top(m)
      return {
        tokens: Math.round(bytes / BYTES_PER_TOKEN),
        bytes,
        calls,
        top: all.slice(0, TOP_N),
        // 被截掉几个 —— 报出来,否则"只有这 8 个工具"和"还有 20 个没列"看起来一样。
        othersOmitted: Math.max(0, all.length - TOP_N)
      }
    }
    return {
      turnIndex: this.turnIndex,
      turn: build(this.turn),
      session: build(this.session),
      // 最大的十几笔 —— 拆分方案从这里开始定。
      biggestCalls: this.bigCalls.map((c) => ({ ...c, tokens: Math.round(c.bytes / BYTES_PER_TOKEN) })),
      // 每回合增量。**尖峰还是累积**:前者拆那一笔,后者要改产物或压缩策略。
      perTurnTokens: this.perTurnTokens.slice(-30)
    }
  }

  /** 一行人话,给日志的 message 用。 */
  line(): string {
    const r = this.report()
    const k = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))
    const biggest = r.session.top[0]
    return (
      `turn #${r.turnIndex}: 本轮工具结果 ${k(r.turn.tokens)} tok / ${r.turn.calls} 次 · ` +
      `会话累计 ${k(r.session.tokens)} tok / ${r.session.calls} 次` +
      (biggest
        ? ` · 最大来源 ${biggest.tool}(${k(biggest.tokens)} tok,${biggest.calls} 次,均 ${Math.round(biggest.meanBytes / 1024)}KB,` +
          `峰值 ${Math.round(biggest.maxBytes / 1024)}KB${biggest.maxSubject ? ` @ ${biggest.maxSubject}` : ''})`
        : '')
    )
  }
}

export const inputBudget = new InputBudget()
