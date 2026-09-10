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

/**
 * OnlyPreview 在**给人看的文案**里的名字。
 *
 * 和 tab id 放在一起,因为它同样是「两边都要用同一个词」的东西:main 侧端口的 displayName 和控制
 * 面板里那句 tooltip 说的必须是同一个名字。这不是品牌名 —— OnlyPreview 在两个仓里都叫
 * OnlyPreview,去 Bitterless 品牌那次针对的是产品名,不是这个功能名。
 */
export const MAESTRO_ONLY_PREVIEW_APP_NAME = 'OnlyPreview'

export const MAESTRO_TRENCH_TAB_ID = 'trench'
export const MAESTRO_TRENCH_DISPLAY_URL = 'bitterless://trench'
