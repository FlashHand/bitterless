// `CaptureOptions` 用 bl 自己那份(coach.api)—— 它是录制选项,bl 早就有,
// 不该为了对齐再抄一份平行定义。其余两型是 apidoc 摄取专有的。
import type { CaptureOptions } from '@maestro-shared/coach.api'
import type { CaptureBlockedGroup, CaptureFilterScope, IngestDropGroup } from '@maestro-shared/apidoc.types'

export interface IngestAdviceInput {
  /**
   * 域级过滤范围。**bl 侧永远 absent** —— bl 的录制没有域级规则。
   * 放在这里而不是往 bl 的 `CaptureOptions` 加字段:那会是一个 bl 永远不设的死字段
   * (为不可能的状态写防御)。摄取建议那段本来就按 "absent = 没有域规则" 处理。
   */
  domainScope?: CaptureFilterScope
  host: string
  options: CaptureOptions
  blocked: CaptureBlockedGroup[]
  blockedCapped: boolean
  /** The filter was edited mid-recording — the printed config is then only part of the truth. */
  filterChangedWhileRecording?: boolean
  /** False = no tally for this recording (app relaunch): empty `blocked` means UNKNOWN, not zero. */
  tallyAvailable?: boolean
  /** Passed the filter, but ingest's own projection refused to document it. */
  drops: IngestDropGroup[]
  /** Endpoints that made it into the doc — so the advisory can put the losses in proportion. */
  documented: number
  /** Endpoints kept but whose body was withheld from the model (file/binary). */
  fileBodyWithheld: number
  /** Exchanges collapsed by same method+path dedupe — explicit, because G1 forbids silent drops. */
  dedupeCollapsed: number
}
