import type { WebSearchApiResponse, WebSearchApiResult } from '@main/net/webSearch.api'

/**
 * 搜索结果 → 模型可读的 Markdown。
 *
 * 形状沿用评测期已在 100 份真实响应上跑过的渲染器(`overmind:areas/websearch/scripts/lib/markdown.mjs`),
 * 但**裁掉两样**:`<details>` 折叠正文(transcript 里没有折叠这回事,会全量进上下文)与延迟/成本行
 * (模型不需要,成本属于 UI)。设计见 `docs/features/agent-web-search.md` `DAW8`/`DAW9`。
 */

/** 单次调用进 transcript 的硬上限。8 条 × 1,200 字符摘录 + 表头开销 ≈ 10k,留 2k 余量。 */
export const WEB_SEARCH_RENDER_BUDGET = 12_000

const oneLine = (value: string, max: number): string => {
  const flat = String(value ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

const cell = (value: string): string => oneLine(value, 90).replace(/\|/g, '\\|')

const blockFor = (item: WebSearchApiResult): string => {
  const lines = [`### [${item.rank}] ${oneLine(item.title, 160) || '(untitled)'}`]
  lines.push(`- url: ${item.url}`)
  lines.push(`- domain: ${item.domain || 'unknown'}`)
  lines.push(`- published: ${item.published_at ? item.published_at.slice(0, 10) : 'not reported'}`)
  if (item.author) lines.push(`- author: ${oneLine(item.author, 80)}`)
  lines.push('')
  // 摘录用引用块包起来:它是**第三方正文**,与工具自己说的话必须在视觉上分开。
  const snippet = String(item.snippet ?? '').trim()
  lines.push(snippet ? snippet.split('\n').map((line) => `> ${line}`).join('\n') : '> (no excerpt returned)')
  if (item.truncated) lines.push('>', '> [excerpt continues beyond this point]')
  return lines.join('\n')
}

export const formatWebSearchResults = (response: WebSearchApiResponse): string => {
  if (!response.results.length) {
    // 零命中**不是错误** —— 与失败合成同一句会让模型对着一次成功的搜索无限重试。
    return `No results for "${oneLine(response.query, 200)}". Try a broader query, or drop the domain filter if you set one.`
  }

  const head = [
    `Web search: "${oneLine(response.query, 200)}" — ${response.results.length} result${response.results.length === 1 ? '' : 's'}`,
    '',
    '| # | domain | published | title |',
    '| --- | --- | --- | --- |',
    ...response.results.map(
      (item) => `| ${item.rank} | ${cell(item.domain || 'unknown')} | ${item.published_at ? item.published_at.slice(0, 10) : '—' } | ${cell(item.title)} |`
    ),
    ''
  ].join('\n')

  // 预算在**渲染后的字符串**上执法,不是在上游请求上:少要几条结果并不能约束最终块的大小,
  // 而一次不加标记的截断在模型看来就是一份完整证据 —— 那正是「自信答错」的成因。
  const blocks: string[] = []
  let used = head.length
  let dropped = 0
  for (const item of response.results) {
    const block = blockFor(item)
    if (used + block.length + 2 > WEB_SEARCH_RENDER_BUDGET) {
      dropped++
      continue
    }
    blocks.push(block)
    used += block.length + 2
  }

  const tail = dropped
    ? `\n\n[${dropped} of ${response.results.length} result${dropped === 1 ? '' : 's'} omitted to stay inside the context budget — they are listed in the table above; narrow the query to see their excerpts]`
    : ''
  return `${head}\n${blocks.join('\n\n')}${tail}`
}
