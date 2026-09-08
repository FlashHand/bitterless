/**
 * 「工具返回的这段文本其实是一次失败吗?」—— **每个 runtime adapter 都必须问这一句。**
 *
 * 宿主工具的 house 约定是:错误成形为一句 `ERROR: …` 的字符串**正常返回**给模型
 * (`read_file` 一路都是这样)。好处是模型读得懂、能自己换路;坏处是在 runtime 眼里
 * 那是一次**成功**返回 —— 于是 `isError` 是 false,日志、活动条、状态条三处都说"成功",
 * 而模型那边其实在做错误恢复。
 *
 * 这条判据 2026-09-02 因 `agent-tool-end 307s tool read_file ok`(实为 30s 超时失败)
 * 加进了 pi adapter。**但只加在了 pi 那一个上**,于是 2026-09-08 在 ai-crms adapter 上
 * 原样复发:`page_snapshot` 连续 4 次返回 `ERROR: no snapshot returned`,每一次的
 * `agent-tool-end` 都是 `tool page_snapshot ok` / `level=info`,而同一毫秒的
 * `coach:activity:observe` 打的是 `warn :: snapshot failed`。八天的日志里
 * `page_snapshot` 一次都没成功过,没人发现,因为工具层那处说成功。
 * 见 `docs/issues/page-snapshot-never-succeeded-and-was-logged-ok.md`。
 *
 * 所以它被抽到这里:判据只有一份,`check-agent-runtime.mjs` 钉住"每个 adapter 都用它"。
 * 加第三个 provider 时,漏掉它会被守卫拦下,而不是等下一次线上排查。
 *
 * 这份判据在 bitterless 与 cowork 两边**各有一份实现**、设计统一(`areas/agent-runtime/`)。
 * 2026-09-08 它曾被抽进共享的 maestro-agent-sdk,当日 Ral 决定放弃那条路:文档统一、实现两边。
 * 改这里时另一边要同步 —— 两边的守卫各自钉着「每个 adapter 都用它」。
 */

/**
 * 工具结果里的文本。宿主工具返回纯字符串;pi 内置工具(read/bash/…)回的是
 * `{output}` / `{text}` / `{content:[{type:'text',text}]}` 这类形状 —— 都摸一遍,摸不到当空。
 */
export const readToolResultText = (result: unknown): string => {
  if (typeof result === 'string') return result
  if (!result || typeof result !== 'object') return ''
  const record = result as { output?: unknown; text?: unknown; content?: unknown }
  if (typeof record.output === 'string') return record.output
  if (typeof record.text === 'string') return record.text
  if (Array.isArray(record.content)) {
    return record.content
      .map((part) =>
        part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : ''
      )
      .join('\n')
  }
  return ''
}

/**
 * `ERROR:` 前缀 = 失败,**即便 runtime 认为这次调用成功了**。
 *
 * 只认前缀,不做模糊匹配:一段正文里出现 "ERROR" 三个字母(页面文本、日志片段、代码)不算失败,
 * 否则一次成功的 `page_snapshot` 读到页面上的 "ERROR" 字样就会被判成失败。
 */
export const toolResultLooksFailed = (result: unknown): boolean =>
  /^\s*ERROR:/.test(readToolResultText(result))
