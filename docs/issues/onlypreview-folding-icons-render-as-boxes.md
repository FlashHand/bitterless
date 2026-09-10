# OnlyPreview folding icons render as boxes instead of chevrons

Status: root cause verified from source; repair implemented in BL and Cowork; owner verification pending (2026-09-10).

## Owner report

Ral, 2026-09-10, after `onlypreview-structured-text-folding-172` landed: previewing a JSON file shows
a hollow rectangle in the gutter where the expand/collapse control should be — 「这里展开/收起的
icon 不是箭头需要优化」. Screenshot: line 11 `"languages": [` carries a `▯` glyph, not a chevron.

## Classification

Defect in task 172, not a new requirement. The task made the folding gutter appear; the control
glyph it relies on was never available on the preview page.

## Root cause (source-verified)

- Monaco's folding decorations are **codicon glyphs**: `foldingDecorations.js` registers
  `folding-expanded` = `Codicon.chevronDown` and `folding-collapsed` = `Codicon.chevronRight`.
  The standalone theme service injects the per-icon rule
  `.codicon-folding-expanded:before { content: '\eab4'; }` (`iconsStyleSheet.js` line 41) — content
  only, **no font-family**. The font comes from the base rule `.codicon[class*='codicon-'] { font:
  … codicon }` plus the `@font-face { font-family: "codicon"; src: url(./codicon.ttf) }`, both in
  `vs/base/browser/ui/codicons/codicon/codicon.css`.
- That CSS is loaded only through `vs/base/browser/ui/codicons/codiconStyles.js`, whose importers
  are `editor.all.js` (the barrel), `suggestWidget.js`, `codeActionMenu.js` and
  `standaloneGotoSymbolQuickAccess.js`. **Neither `editor.api` nor `contrib/folding/browser/folding.js`
  imports it.** `MonacoTextPreview.vue` uses the API-only entry on purpose (see
  `docs/features/code-highlighting-shiki.md`), so the preview page never declared the `codicon` font.
- Without the font, the `\eab4` private-use codepoint is drawn by the fallback font, which has no
  such glyph → the missing-glyph rectangle in the screenshot.
- Built-output evidence: in `out/renderer`, the only stylesheet declaring `font-family: "codicon"`
  is `SystemPromptSetting-*.css` (Home renderer). The preview page's HTML links `global-*.css`, and
  Monaco's own CSS arrives via the async `MonacoTextPreview-*.css` chunk — which had no codicon rule.
- Not the cause: CSP (`font-src * bitterless-preview: data: blob:` on `preview/index.html` allows
  the font), the renderer protocol (packaged = `file://`, dev = Vite dev server; neither filters
  `.ttf`), or Vite asset handling (the Home renderer's `codicon-*.ttf` is emitted fine).

## Repair

One side-effect import in `MonacoTextPreview.vue`, next to the folding contribution import:

```ts
import 'monaco-editor/esm/vs/base/browser/ui/codicons/codiconStyles';
```

Exactly what `editor.all.js` does ("The codicons are defined here and must be loaded"). It brings
`codicon.css` + `codicon-modifiers.css` (~2 KB) into the Monaco CSS chunks the preview page already
loads through the preload helper. The 80 KB `codicon.ttf`: in Bitterless it is **already emitted**
for the Home renderer (`out/renderer/assets/codicon-*.ttf`, same content hash, shared `assets/`), so
packaged size is unchanged; in Cowork it is a new ~80 KB asset. The module has no `.d.ts`; a bare
side-effect import is not type-checked (TS 5.9, `noUncheckedSideEffectImports` off in both repos) —
so a typo in that specifier would only surface at Vite dev/build time, not in `typecheck:web`.

Adversarial check (2026-09-10, six-agent workflow): three refuters — import graph (BFS over 578
modules reachable from `editor.api`, 170 from `folding.js`; no path to `codiconStyles`), rendering
(no other rule draws a box; `folding.css`'s `font-size: 140%` only overrides size), asset delivery
(CSP, `file://`/dev-server loading, Vite emission, session hooks) — all left the root cause standing.
Three reviewers approved the fix with nits, folded into the test and this doc.

**Owner-test caveat:** `out/renderer` still holds the pre-fix build. A packaged run or a stale
`yarn dev` process shows boxes until it is rebuilt/restarted; that is not the fix failing.

Rejected: drawing our own chevrons with CSS masks over `.codicon-folding-*`. It would hide the real
gap (any other codicon Monaco renders in the preview would still be a box) for more code.

## Verification

- `tests/onlypreview/onlyPreviewMonacoFolding.test.mjs` gains: the SFC imports `codiconStyles`;
  neither `editor.api.js` nor `folding.js` does (so the import stays necessary); `codicon.css`
  still declares the `codicon` `@font-face`; `foldingDecorations.js` still uses codicon chevrons.
- `yarn typecheck:web`: no error in the touched file.
- Owner manual test: reopen the same JSON — expanded lines show `⌄`, collapsed lines `›`, no boxes.
- Cowork: same file byte-identical, same test in `apps/cowork/tests/unit/`; issue mirrored at
  `docs/issues/onlypreview-folding-icons-render-as-boxes.md` there.
