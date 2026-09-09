// Per-site exploration rules. Contract: docs/features/agent-driven-exploration.md decision 4.
//
// Ral 2026-08-10:「每个站点应该也有个录制规则,例如规则中说了某个按钮别点,下次录制就别点了」.
//
// This is the compensating control for decision 2 (the agent judges write-risk from page context,
// with no interception gate): a misjudgement must be learned ONCE. Rules are consulted BEFORE the
// agent is offered a control — a rule removes the temptation rather than trusting the model to
// remember what it broke last time.
//
// Written by the agent when it discovers a control was destructive, and hand-editable by Ral: it is
// plain JSON under <userData>/sites/<siteId>/rules.json.

import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SiteRuleEntry, SiteRules } from '@maestro-main/sitemap/siteRules.types'

const emptyRules = (siteId: string): SiteRules => ({ siteId, dontClick: [], dontVisit: [], searchValues: [] })

const rulesPath = (siteId: string): string => join(app.getPath('userData'), 'sites', siteId, 'rules.json')

export const loadSiteRules = async (siteId: string): Promise<SiteRules> => {
  try {
    const parsed = JSON.parse(await readFile(rulesPath(siteId), 'utf8')) as Partial<SiteRules>
    return {
      siteId,
      dontClick: Array.isArray(parsed.dontClick) ? parsed.dontClick : [],
      dontVisit: Array.isArray(parsed.dontVisit) ? parsed.dontVisit : [],
      searchValues: Array.isArray(parsed.searchValues) ? parsed.searchValues : [],
      updatedAt: parsed.updatedAt
    }
  } catch {
    // No rules yet is the normal first-run state, not an error.
    return emptyRules(siteId)
  }
}

export const saveSiteRules = async (rules: SiteRules): Promise<void> => {
  const dir = join(app.getPath('userData'), 'sites', rules.siteId)
  await mkdir(dir, { recursive: true })
  await writeFile(rulesPath(rules.siteId), JSON.stringify({ ...rules, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
}

/** Add rules without duplicating. Returns how many were actually new, so the caller can report it. */
export const addSiteRules = async (
  siteId: string,
  patch: { dontClick?: { value: string; reason: string }[]; dontVisit?: { value: string; reason: string }[]; searchValues?: string[] },
  by: 'agent' | 'human' = 'agent'
): Promise<{ rules: SiteRules; added: number }> => {
  const rules = await loadSiteRules(siteId)
  const at = new Date().toISOString()
  let added = 0
  for (const item of patch.dontClick || []) {
    const value = item.value.trim()
    if (!value || rules.dontClick.some((r) => r.value === value)) continue
    rules.dontClick.push({ value, reason: item.reason || '', by, at })
    added += 1
  }
  for (const item of patch.dontVisit || []) {
    const value = item.value.trim()
    if (!value || rules.dontVisit.some((r) => r.value === value)) continue
    rules.dontVisit.push({ value, reason: item.reason || '', by, at })
    added += 1
  }
  for (const value of patch.searchValues || []) {
    const v = String(value).trim()
    if (!v || rules.searchValues.includes(v)) continue
    rules.searchValues.push(v)
    added += 1
  }
  if (added) await saveSiteRules(rules)
  return { rules, added }
}

/**
 * 精确匹配 + 【单向】包含:控件名包含规则值才算(规则「删除」挡得住「批量删除」)。
 *
 * 反向包含(规则值包含控件名)必须【不能】有 —— 那等于让一条具体规则去挡一个更通用的控件,
 * 实测后果(2026-08-13,test-dsh-admin):
 *   · 规则「详情弹窗 编辑」 → 挡死了裸按钮「详情」
 *   · 规则「管理基地负责人」 → 挡死了裸按钮「管理」
 *   · 规则「导出报表」       → 挡死了裸按钮「导出」
 * 而「详情」正是列表页最该点的那个读控件(detail/getById 这批接口只在点它时才发),于是每个列表页
 * 的详情接口被永久静默锁死 —— 漏掉的 74 个 read 接口大半出在这儿。规则是【单调累积、永不过期】的,
 * 所以一条写宽了的规则会一直毒下去,匹配面越窄越安全。
 */
export const isClickForbidden = (rules: SiteRules, controlName: string): SiteRuleEntry | null => {
  const name = (controlName || '').trim()
  if (!name) return null
  const lower = name.toLowerCase()
  return (
    rules.dontClick.find((r) => r.value === name) ||
    rules.dontClick.find((r) => lower.includes(r.value.toLowerCase())) ||
    null
  )
}

export const isVisitForbidden = (rules: SiteRules, url: string): SiteRuleEntry | null => {
  const u = (url || '').trim()
  if (!u) return null
  return rules.dontVisit.find((r) => u === r.value || u.startsWith(r.value)) || null
}

export const renderSiteRules = (rules: SiteRules): string => {
  if (!rules.dontClick.length && !rules.dontVisit.length && !rules.searchValues.length) {
    return 'site rules: none yet. Record one with explore_record when you find a control that writes data.'
  }
  const lines = ['site rules:']
  for (const r of rules.dontClick) lines.push(`  DO NOT CLICK "${r.value}" — ${r.reason} (${r.by})`)
  for (const r of rules.dontVisit) lines.push(`  DO NOT VISIT ${r.value} — ${r.reason} (${r.by})`)
  if (rules.searchValues.length) lines.push(`  safe search values: ${rules.searchValues.slice(0, 12).join(' · ')}`)
  return lines.join('\n')
}
