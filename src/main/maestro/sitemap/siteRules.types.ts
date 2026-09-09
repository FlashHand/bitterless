export interface SiteRuleEntry {
  /** Control name or URL this rule is about. */
  value: string
  /** Why — so a rule can be reviewed later instead of being cargo-culted forever. */
  reason: string
  /** 'agent' = learned during exploration; 'human' = Ral wrote it. */
  by: 'agent' | 'human'
  at: string
}

export interface SiteRules {
  siteId: string
  /** Controls the explorer must NOT click. Matched by exact name, else case-insensitive substring. */
  dontClick: SiteRuleEntry[]
  /** URLs / prefixes the explorer must NOT open (the off-site exit list folds in here). */
  dontVisit: SiteRuleEntry[]
  /**
   * Values that are SAFE to type into a search box on this site (decision 5): only values already
   * seen on the page. An invented or empty query can be a full-table scan on a customer's database.
   */
  searchValues: string[]
  updatedAt?: string
}
