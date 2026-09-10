---
id: onlypreview-structured-text-folding-172
scope: JSON/XML/YAML text preview folds, opens with five nesting levels expanded, copies folded text
status: done
depends-on: []
verify: node --test tests/onlypreview/onlyPreviewMonacoFolding.test.mjs tests/onlypreview/onlyPreviewHighlight.test.mjs; yarn typecheck:web (no error in touched files); owner manual test in BL and Cowork
---

# OnlyPreview structured-text folding

## Objective

Ral, 2026-09-10: 「我期望 bl cowork 对 json xml yaml 预览时可以折叠，并且预览时默认最多预览 5 层，
还有就是，复制的话，被折叠内容要能正常被复制」.

Three contracts, for **both** Bitterless and Cowork (the Monaco preview is vendored byte-identical,
see `docs/features/code-highlighting-shiki.md` — "两仓逐字节相同"):

1. A `.json` / `.json5` / `.xml` / `.yaml` / `.yml` preview has a folding gutter; every nested block
   can be collapsed and expanded, by chevron, by clicking the `···` placeholder, or by Monaco's fold
   keyboard chords.
2. It opens with **five** nesting levels expanded. Blocks at nesting level 6 start collapsed, which
   hides everything deeper as well.
3. Copying a selection that spans a collapsed block copies the **hidden lines too** — the clipboard
   gets the file text, not the screen text. Cmd+A → Cmd+C on a folded file yields the whole file.

## Findings that shaped the design

- `MonacoTextPreview.vue` imports Monaco's **API-only entry** (`editor.api`). That entry does not
  load `contrib/folding` — verified by reading `editor.api.js` and `standaloneEditor.js`; only the
  `editor.all.js` barrel does. So `folding: true` alone changes nothing today. The contribution has to
  be imported for its side effect (`registerEditorContribution(FoldingController…, Eager)`), and it
  must be imported **before** `monaco.editor.create` so the editor instantiates it.
- The contribution ships a `folding.d.ts` that is exactly `export {}`. A side-effect import is
  therefore type-clean under the strict web tsconfig with **no** local `.d.ts` and **no** untyped
  internal imports. `foldingModel.js` (where `setCollapseStateAtLevel` lives) has no typings, so it
  is not imported; the same behaviour is reached through the **public** `editor.getAction(id).run()`.
- Monaco 0.52.2 registers `editor.foldLevel1` … `editor.foldLevel7` (`folding.js`, the `for (let i =
  1; i <= 7; i++)` loop). `FoldLevelAction.invoke` calls `setCollapseStateAtLevel(model, level, true,
  selectedLines)`; `level` is the depth in `getRegionsInside`'s level stack, **1 = outermost block**.
  So "five levels expanded" = run `editor.foldLevel6`. The action itself awaits the folding model
  (`FoldingAction.runEditorCommand` → `getFoldingModel().then(...)`), so no extra readiness dance is
  needed; the returned promise settles when the fold has been applied.
- The action skips regions containing a selected line. The fresh editor's cursor is at line 1, and
  no level-6 region can contain line 1 (nested regions start strictly after their parent's start).
- Copying is a **core** path, not a contribution: `browser/controller/textAreaHandler.js` builds the
  clipboard text with `viewModel.getPlainTextToCopy(this._modelSelections, …)` — **model** ranges,
  so hidden lines are included. Electron's Edit → Copy role runs `document.execCommand('copy')`,
  which fires the same DOM `copy` event on Monaco's textarea. Contract 3 therefore needs **no code**;
  it needs a guard so a Monaco upgrade that changes this is noticed.
- `props.language` is the classifier's id (`onlyPreviewClassifier.service.ts` `LANGUAGE_BY_EXTENSION`):
  `.json → json`, `.json5 → json5`, `.xml → xml`, `.yaml`/`.yml → yaml`. The fold decision keys on
  that id, not on the shiki-normalised highlight language.
- Moving the cursor into a hidden range auto-expands it (`FoldingController.revealCursor`), so the
  find adapter's `revealRangeInCenter` on a match inside a folded block unfolds that block. Nothing to
  add there.

## Design

- New pure module `src/renderer/onlypreview/preview/src/onlyPreviewMonacoFolding.service.ts` with no
  imports (so `node --test` can load it directly):
  - `ONLY_PREVIEW_FOLDING_LANGUAGES = {json, json5, xml, yaml}`, `ONLY_PREVIEW_FOLDING_VISIBLE_LEVELS = 5`;
  - `resolveOnlyPreviewMonacoFolding(language)` → `{ folding, collapseActionId }`:
    `{ true, 'editor.foldLevel6' }` for the four ids (case-insensitive), `{ false, null }` otherwise.
- `MonacoTextPreview.vue`:
  - side-effect `import 'monaco-editor/esm/vs/editor/contrib/folding/browser/folding'` next to the
    `editor.api` import, with a comment explaining why the API-only entry needs it;
  - `folding: plan.folding`, `foldingStrategy: 'indentation'`, `showFoldingControls: 'always'` in the
    create options. `folding` is **explicit** so the other languages keep today's no-gutter look —
    once the contribution is loaded, Monaco's own default (`folding: true`) would otherwise switch the
    gutter on for every text preview, which was not asked for;
  - after create, fire-and-forget `editor.getAction(plan.collapseActionId)?.run()` with a `catch`:
    Monaco rejects the pending fold with a cancellation error if the editor is disposed (file switch)
    while the folding model is still being computed, and there is nothing else to do in that case.
    Not awaited, so `ready`, the find adapter and character counting are not delayed by the ~200 ms
    folding-model debounce.
- `foldingStrategy: 'indentation'` is deliberate: no folding-range provider is registered for these
  ids (the JSON language contribution is not loaded either), so `'auto'` would fall back to
  indentation anyway; pinning it keeps the behaviour stable if a language contribution ever lands.

## Known limits (accepted)

- Indentation folding needs indentation. A minified single-line JSON has no fold regions; nothing
  collapses and the gutter stays empty. Word wrap does not create regions.
- Files Monaco marks too large for tokenization (`largeFileOptimizations`, ~20 MB) get no folding at
  all — same gate that already disables colouring for them.
- Only level 6 is collapsed on open. Expanding one level-6 block shows its children expanded. Monaco
  exposes fold-level actions up to 7 only; deeper "one level at a time" was not requested.

## Verification

- `tests/onlypreview/onlyPreviewMonacoFolding.test.mjs`:
  - the resolver maps the four ids to `folding: true` + `editor.foldLevel6`, everything else off;
  - the visible-level constant stays within Monaco's registered `foldLevel1..7` range;
  - the SFC imports the folding contribution before creating the editor, passes the resolver's
    `folding`, `foldingStrategy: 'indentation'`, `showFoldingControls: 'always'`, and runs the
    collapse action; it never hard-codes `folding: true`;
  - Monaco 0.52.x still registers seven fold levels and still copies from `_modelSelections` in
    `textAreaHandler.js` (contract 3 guard).
- `yarn typecheck:web`: no error in touched files (pre-existing baseline unrelated).
- Owner manual test (BL and Cowork): open a deep `.json`; gutter chevrons present, level 6 collapsed;
  Cmd+A, Cmd+C → paste equals the file; open a `.ts` → no gutter change.
- Electron E2E: not run (workspace rule).

## Follow-up

- 2026-09-10, owner report after delivery: the fold controls rendered as hollow boxes. Root cause and
  repair (one `codiconStyles` side-effect import) in
  `docs/issues/onlypreview-folding-icons-render-as-boxes.md`; the guard lives in the same test file.

## Cowork port

Same three files, byte-identical `MonacoTextPreview.vue` and service; the test moves to
`apps/cowork/tests/unit/` and locates Monaco through `createRequire` (hoisted to the repo root there).
Tracked as `mini-034`.
