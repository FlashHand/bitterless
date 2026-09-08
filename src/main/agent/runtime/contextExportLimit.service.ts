/**
 * 上下文导出的尺寸闸 —— **宿主策略,不是 agent 逻辑**,所以留在 bitterless 而不进 SDK。
 *
 * 组装本身已经交给 `@main/agent/contextExport.service`(条目分型 + 工具调用参数展开 + 字符计数,
 * 且图片只写 `[image]` 不展开 base64)。这里只管一件 SDK 不该替宿主决定的事:一次往剪贴板里
 * 塞多大算过分。原来的 `snapshotRuntimeContext` 已被 SDK 的 entry 级组装取代,一并删除。
 */
export const MAX_CONTEXT_EXPORT_CHARS = 8 * 1024 * 1024

export const assertContextTextSize = (text: string): void => {
  if (text.length > MAX_CONTEXT_EXPORT_CHARS) throw new Error('Context export exceeds the 8 MiB text limit; nothing was copied.')
}
