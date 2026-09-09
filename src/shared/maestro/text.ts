// 从 cowork 的 `shared/text.ts` 搬入(drill-001):apidoc 摄取用 `sliceCodeUnits` 做定长切片。
// Shared text helpers.

// Slice `text` to at most `end` UTF-16 code units WITHOUT leaving a lone high surrogate at
// the boundary. A plain `slice(0, end)` can cut an astral character (surrogate pair — e.g. a
// CJK Ext-B ideograph like 𠮷 U+20BB7, or an emoji) in half, leaving a lone high surrogate that
// renders as U+FFFD (�) and corrupts JSON round-trips. Common BMP text — including the whole
// U+4E00–U+9FFF Chinese range — is one code unit per char and is unaffected.
export const sliceCodeUnits = (text: string, end: number): string => {
  const cut = text.slice(0, Math.max(0, end))
  const last = cut.charCodeAt(cut.length - 1)
  // A trailing high surrogate (0xD800–0xDBFF) can only be lone here — its low half was cut off.
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}
