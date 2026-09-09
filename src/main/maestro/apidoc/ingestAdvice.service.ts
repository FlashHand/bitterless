// Ingest's filter/coverage advisory.
// Contract: docs/features/ingest-filter-advice.md; upstream design overmind:areas/agent-runtime/cowork/ingest-pipeline.html #6.
//
// The problem this solves: a capture filter decides what was ever RECORDED. An endpoint outside the
// whitelist — or inside a blacklist rule — never reaches ingest, so the apidoc simply comes out short
// and nothing anywhere says why. Ral 2026-08-10:「有的接口是白名单外的,ingest 的时候要知道当前的
// 白名单黑名单,有的接口可能需要被加到白名单中……除了分析出 apidoc 产物,还需要给出你的建议」.
//
// DELIBERATELY deterministic, not LLM-authored. The whole input is hostnames and counts; a model
// would add latency and the chance of inventing a rule that drops real traffic. Every recommendation
// must name the counts it rests on — no evidence, no recommendation.

import type { CaptureBlockedGroup, IngestAdvice, IngestFilterRecommendation } from '@maestro-shared/apidoc.types'
import type { CaptureRule } from '@maestro-shared/captureFilter.api'
import { sameRegistrableSite } from '@maestro-main/drive/requestExec.helper'
import type { IngestAdviceInput } from './ingestAdvice.types'

// Noise threshold for a blacklist recommendation. Below this a host is a one-off, not a pattern worth
// a permanent rule — a filter rule the operator has to maintain must earn its place.
const NOISE_MIN_REQUESTS = 5
const THIRD_PARTY_MIN_HOSTS = 3

const ruleText = (r: CaptureRule): string => `${r.rule} ${r.value}`

/**
 * `crms.micromeet.ai` → `micromeet.ai`. Deliberately naive (no public-suffix list): the result is only
 * a SUGGESTED whitelist value the operator reviews before applying.
 *
 * An IP or a single-label host is returned VERBATIM. Trimming one would be actively harmful:
 * `192.168.1.5` → `1.5` still matches via the `endsWith('.' + v)` rule, but it also matches
 * `10.0.1.5` — a suggested rule must never be broader than the host it was derived from.
 */
const registrableOf = (host: string): string => {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return host
  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) return host
  // Two-part public suffixes (`com.cn`, `co.uk`) need three labels to stay meaningful.
  const tail2 = parts.slice(-2).join('.')
  if (/^(com|net|org|gov|edu|co)\.[a-z]{2}$/i.test(tail2)) return parts.slice(-3).join('.')
  return tail2
}

export const buildIngestAdvice = (input: IngestAdviceInput): IngestAdvice => {
  const o = input.options
  // 从 input 读,不从 `options` 读 —— bl 的 CaptureOptions 没有这个字段(见 ingestAdvice.types)。
  const domainScope = input.domainScope
  const recommendations: IngestFilterRecommendation[] = []
  const notes: string[] = []
  // No tally → every count below is "unknown", not "zero". Recommendations derived from `blocked`
  // simply do not appear (the array is empty), which is correct; what must NOT appear is a clean bill.
  const unknownTally = input.tallyAvailable === false

  // ── 1. Endpoints LOST to the filter. Highest severity: the apidoc is short and only this says why.
  //    Biggest loss first — within one action the count IS the priority.
  const blockedByImpact = [...input.blocked].sort((a, b) => b.apiLike - a.apiLike || b.count - a.count)
  /** Blocked, api-like, but on a FOREIGN host — reported as a fact, never as a whitelist recommendation. */
  const foreignBlocked: CaptureBlockedGroup[] = []
  for (const b of blockedByImpact) {
    if (!b.apiLike) continue
    // SAME-SITE GATE. Without it every XHR tracker (GA `/g/collect`, Sentry `/api/N/envelope/`,
    // Intercom) counted as a "lost business endpoint" — `looksLikeBusinessRequest` says true for any
    // fetch/xhr — so a correctly whitelisted recording raised a false loss alarm AND the advice, if
    // applied, widened the whitelist to admit pure telemetry: the exact volume growth that the
    // add-blacklist recommendation exists to cut. It also contradicted this file's own cross-site
    // note, which correctly says a foreign host can never enter the apidoc (`buildApiDocInput` drops
    // it at `sameRegistrableSite`) — so whitelisting it changes nothing. Now both paths agree.
    if (input.host && b.host && !sameRegistrableSite(b.host, input.host)) {
      foreignBlocked.push(b)
      continue
    }
    const where = b.scope === 'domain' ? (domainScope?.domain || input.host) : ''
    const evidence = `拦掉 ${b.count} 条,其中 ${b.apiLike} 条像业务接口(样例 ${b.samplePath || '—'})`
    if (b.reason.endsWith('whitelist-miss')) {
      recommendations.push({
        action: 'add-whitelist',
        scope: where,
        rule: 'domain-suffix',
        value: b.host,
        reason: `${b.scope === 'domain' ? '站点' : '全局'}白名单没有覆盖 ${b.host},它的业务请求没进录制,apidoc 因此缺这批端点`,
        evidence
      })
    } else {
      recommendations.push({
        action: 'remove-blacklist',
        scope: where,
        rule: (b.rule.split(' ')[0] as 'domain-suffix' | 'url-prefix') || 'domain-suffix',
        value: b.rule.split(' ').slice(1).join(' ') || b.host,
        reason: `${b.scope === 'domain' ? '站点' : '全局'}黑名单规则 \`${b.rule}\` 拦掉了业务请求 —— 若这些端点要进 apidoc,删掉或收窄它`,
        evidence
      })
    }
  }

  // ── 2. Noise worth blacklisting. Only THIRD-PARTY hosts: same-host static assets are already out of
  //    the doc, and blacklisting them buys nothing but a rule to maintain. A third-party host, by
  //    contrast, is pure recording volume — which is the growth Ral flagged on 2026-07-28.
  const thirdParty = input.drops
    .filter((d) => d.reason === 'cross-site' && !d.apiLike && d.count >= NOISE_MIN_REQUESTS)
    .sort((a, b) => b.count - a.count) // loudest noise source first — that is the one worth a rule
  for (const d of thirdParty) {
    recommendations.push({
      action: 'add-blacklist',
      scope: '',
      rule: 'domain-suffix',
      value: d.host,
      reason: `${d.host} 录到了流量但没有一条是业务接口 —— 纯噪声,加黑可直接降低录制体积`,
      evidence: `录到 ${d.count} 条,业务接口 0 条(样例 ${d.samplePath || '—'})`
    })
  }

  // ── 3. The single highest-leverage config, when no whitelist is on at all and the recording pulled in
  //    several foreign hosts. Recommended per-site, not globally: a global whitelist would silently
  //    starve every OTHER site's recording.
  const anyWhitelistOn = o.networkWhitelistEnabled || !!domainScope?.whitelistEnabled
  const foreignHosts = new Set(input.drops.filter((d) => d.reason === 'cross-site').map((d) => d.host))
  if (!anyWhitelistOn && foreignHosts.size >= THIRD_PARTY_MIN_HOSTS && input.host) {
    recommendations.push({
      action: 'enable-whitelist',
      scope: input.host,
      rule: 'domain-suffix',
      value: registrableOf(input.host),
      reason: `本次录制混进了 ${foreignHosts.size} 个外站 host,而两个作用域的白名单都关着 —— 给这个站开白名单只录自家域,是降噪最省事的一刀`,
      evidence: `外站 host ${[...foreignHosts].slice(0, 6).join(', ')}${foreignHosts.size > 6 ? ' …' : ''}`
    })
  }

  // Losses first, then noise reduction — the operator should read what COST him endpoints before what
  // merely costs him disk.
  const severity: Record<IngestFilterRecommendation['action'], number> = {
    'remove-blacklist': 0,
    'add-whitelist': 1,
    'enable-whitelist': 2,
    'add-blacklist': 3
  }
  // Severity only. Array.sort is stable, so each group keeps the impact order it was built in
  // (blocked by apiLike desc, noise by count desc) — sorting by `value` here would have thrown that
  // away and listed a 9-request CDN above a 34-request tracker.
  recommendations.sort((a, b) => severity[a.action] - severity[b.action])

  // ── Notes: facts that explain the artifact's shape but need no config change.
  const crossSiteApi = input.drops.filter((d) => d.reason === 'cross-site' && d.apiLike > 0)
  for (const d of crossSiteApi) {
    notes.push(
      `跨站 host ${d.host} 录到了 ${d.apiLike} 个业务请求,但摄取只文档化同一可注册站点的端点 → 这批没进 apidoc(白名单帮不上,这是摄取投影的口径,不是过滤器)`
    )
  }
  if (foreignBlocked.length) {
    const shown = foreignBlocked.slice(0, 5).map((b) => `${b.host}(${b.apiLike})`).join(', ')
    notes.push(
      `过滤器还拦掉了 ${foreignBlocked.length} 个外站 host 的 XHR/fetch 请求:${shown}${foreignBlocked.length > 5 ? ' …' : ''}` +
        ' —— **刻意不建议加白**:外站端点即便录到也进不了本站 apidoc(同上一条的口径),而埋点/监控大多正是 XHR。要用它们得单独录那个站。'
    )
  }
  if (input.fileBodyWithheld) {
    notes.push(`${input.fileBodyWithheld} 个文件/二进制端点已进 apidoc,但 body 没送模型(附件、导出、上传)—— 参数与用途仍被文档化,响应形态标注为文件`)
  }
  if (input.dedupeCollapsed) {
    notes.push(`${input.dedupeCollapsed} 条录制被同 method+path 去重合并(保留信息最全的那条)—— 不是丢弃,同一端点只需一份证据`)
  }
  const preflight = input.drops.filter((d) => d.reason === 'preflight').reduce((n, d) => n + d.count, 0)
  if (preflight) notes.push(`${preflight} 条 OPTIONS/HEAD 预检未文档化 —— 不是业务端点`)
  if (input.blockedCapped) {
    notes.push('过滤器拦截统计触到了 200 组上限 —— 下面列出的被拦分组不完整(通常意味着某条通配规则在大量拦截)')
  }
  if (input.filterChangedWhileRecording) {
    notes.push('⚠ 本次录制期间黑白名单被改过 —— 上面打印的是【录制开始时】的配置,后半段的拦截是在另一份配置下发生的。要让建议干净,改完过滤器重录一次')
  }
  // The exoneration note is a POSITIVE claim, so it needs a tally to rest on. `tallyAvailable === false`
  // (app relaunched between recording and ingest) means unknown, and `blockedCapped` can only be true
  // when blocks exist — claiming "nothing was blocked" in either case would be a confident false negative.
  if (unknownTally) {
    notes.push(
      '⚠ 本次没有这段录制的过滤器记账(应用在录制与摄取之间重启过?)—— 上面打印的是【当前】的黑白名单,而"被拦掉多少"无法判定。' +
        '不要把它读成"没有请求被拦掉";要拿到可信的建议,重录一段再摄取。'
    )
  } else if (!input.blocked.length && !input.blockedCapped && !anyWhitelistOn) {
    notes.push('两个作用域的白名单都关着,黑名单没有命中 → 本次录制没有任何请求被过滤器拦掉,apidoc 的缺口(若有)不是过滤器造成的')
  }
  if (!o.recordNetwork) {
    notes.push('⚠ 网络录制开关是【关】的 —— 一个请求都不会进录制,apidoc 为空与黑白名单无关。先在 Capture 面板打开它')
  }

  const advice: IngestAdvice = {
    host: input.host,
    filters: {
      recordNetwork: o.recordNetwork,
      globalWhitelistEnabled: o.networkWhitelistEnabled,
      globalWhitelist: o.networkWhitelist.map(ruleText),
      globalBlacklist: o.networkBlacklist.map(ruleText),
      domain: domainScope?.domain || '',
      domainWhitelistEnabled: !!domainScope?.whitelistEnabled,
      domainWhitelist: (domainScope?.whitelist || []).map(ruleText),
      domainBlacklist: (domainScope?.blacklist || []).map(ruleText)
    },
    recommendations,
    blocked: input.blocked,
    drops: input.drops,
    notes,
    text: ''
  }
  advice.text = renderIngestAdvice(advice, input)
  return advice
}

const ACTION_LABEL: Record<IngestFilterRecommendation['action'], string> = {
  'remove-blacklist': '删/收窄黑名单',
  'add-whitelist': '加白名单',
  'enable-whitelist': '开白名单',
  'add-blacklist': '加黑名单'
}

/** Kept in sync with `buildIngestAdvice`'s own `unknownTally` — see `IngestAdviceInput.tallyAvailable`. */
const list = (label: string, on: boolean | null, rules: string[]): string => {
  const state = on === null ? '' : on ? '开启' : '关闭'
  const body = rules.length ? rules.join(' · ') : '(空)'
  return `- ${label}${state ? `:${state}` : ''} — ${body}`
}

export const renderIngestAdvice = (advice: IngestAdvice, input: IngestAdviceInput): string => {
  const f = advice.filters
  const lines: string[] = [`## 摄取建议 · ${advice.host}`, '', '### 黑白名单(本次录制【开始时】生效的)']
  // First line is the master switch: with it off, no rule below matters at all.
  lines.push(`- 网络录制:${f.recordNetwork ? '开启' : '**关闭**(下面的规则都不起作用)'}`)
  lines.push(list('全局白名单', f.globalWhitelistEnabled, f.globalWhitelist))
  lines.push(list('全局黑名单', null, f.globalBlacklist))
  if (f.domain) {
    lines.push(list(`站点白名单(${f.domain})`, f.domainWhitelistEnabled, f.domainWhitelist))
    lines.push(list(`站点黑名单(${f.domain})`, null, f.domainBlacklist))
  } else {
    lines.push('- 站点作用域:未设置(只有全局规则生效)')
  }

  const unknown = input.tallyAvailable === false
  lines.push('', '### 建议(按影响排序)')
  if (!advice.recommendations.length) {
    lines.push(
      unknown
        ? '- 无法给出黑白名单建议 —— 缺少本段录制的过滤器记账(见下面的说明)。这不等于"没有问题"'
        : '- 无 —— 当前过滤器下没有发现漏录的业务接口,也没有值得加黑的噪声来源'
    )
  } else {
    advice.recommendations.forEach((r, i) => {
      const scope = r.scope ? `站点 ${r.scope}` : '全局'
      lines.push(`${i + 1}. **[${ACTION_LABEL[r.action]} · ${scope}]** \`${r.rule} ${r.value}\``)
      lines.push(`   - 为什么:${r.reason}`)
      lines.push(`   - 证据:${r.evidence}`)
    })
  }

  lines.push('', '### 覆盖账')
  lines.push(`- 进 apidoc 的端点:${input.documented}`)
  if (unknown) {
    // Printing 0 here would be the lie. Say unknown.
    lines.push('- 被过滤器拦掉的业务请求:**未知**(无记账)')
    lines.push('- 过滤器拦掉的总请求数:**未知**(无记账)')
  } else {
    const lostToFilter = advice.blocked.reduce((n, b) => n + b.apiLike, 0)
    lines.push(`- 被过滤器拦掉的业务请求:${lostToFilter}${lostToFilter ? '(见上面的建议 1…)' : ''}`)
    lines.push(`- 过滤器拦掉的总请求数:${advice.blocked.reduce((n, b) => n + b.count, 0)}`)
  }

  if (advice.notes.length) {
    lines.push('', '### 说明')
    for (const n of advice.notes) lines.push(`- ${n}`)
  }
  lines.push('', '> 改配置的地方:Workbench ▸ Capture ▸ 过滤器面板(全局与站点两个作用域)。规则只影响【是否记录】,永不取消请求。')
  return lines.join('\n')
}

/** One-line form for a toast / tool result header. */
export const summarizeAdvice = (advice: IngestAdvice): string => {
  if (!advice.recommendations.length) return '过滤器建议:无(未发现漏录或噪声)'
  const by = new Map<string, number>()
  for (const r of advice.recommendations) by.set(ACTION_LABEL[r.action], (by.get(ACTION_LABEL[r.action]) || 0) + 1)
  const lost = advice.blocked.reduce((n, b) => n + b.apiLike, 0)
  return `过滤器建议 ${advice.recommendations.length} 条(${[...by].map(([k, v]) => `${k} ${v}`).join(' · ')})${lost ? ` —— 本次有 ${lost} 个业务请求被过滤器拦掉` : ''}`
}
