export interface EndpointDescriptor {
  method: string
  path: string
  origin: string
  /** Observed query param NAMES → '' (shape only, never the recorded value). */
  query: Record<string, string>
  bodyParamNames?: string[]
  required: string[]
  role: 'read' | 'write' | 'unknown'
  seen: number
  observedStatus?: number
}

export interface DomainProfileArtifact {
  host: string
  updatedAt: number
  /** How this API signals business failure, when it does so with a 2xx status. */
  successRule?: { field: string; equals: unknown }
  staticHeaders?: Record<string, string>
  signers?: { header: string; siteFn: string }[]
}

/**
 * apidoc 产物落盘的结果(端点数 / 有没有写 client.mjs)。
 *
 * **和 `files/artifactWriter.types.ts` 的 `ArtifactWriteResult` 是两回事**,2026-08-26 改名分开:
 * 那个是「给人看的产物文件」(ok/path/size),这个是「一个站的 apidoc 目录」。同名不同形放着,
 * 迟早有人 import 错一个而 TS 只在字段用错时才报 —— 而两者的字段几乎不重叠,错得会很晚才现形。
 */
export interface ApidocArtifactWriteResult {
  host: string
  dir: string
  endpointCount: number
  wroteClient: boolean
  droppedNonBusiness: number
}
