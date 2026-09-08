// A composite mini-app tab has no page and therefore no real URL. It still needs something for the
// address row, and a `bitterless://` identity is what the bundled Home tab already shows there.
// Hyphenated, matching the product name as it is written everywhere the user sees it (Ral
// 2026-09-07). `micromeet-cowork` uses the same slug for its own port — `micromeet://only-preview`.
export const MAESTRO_ONLY_PREVIEW_DISPLAY_URL = 'bitterless://only-preview'

/**
 * The registered spec id for OnlyPreview's composite tab.
 *
 * Lives on the maestro-shared side, with the display URL, because BOTH halves need it and the alias
 * boundary lets neither import the other's module: the host registers a spec under this id, and
 * Maestro looks a tab up by it. The host re-exports it so its own call sites keep one import.
 */
export const MAESTRO_ONLY_PREVIEW_TAB_ID = 'onlypreview'

export const MAESTRO_TRENCH_TAB_ID = 'trench'
export const MAESTRO_TRENCH_DISPLAY_URL = 'bitterless://trench'
