---
id: onlypreview-standalone-close-takeover-137
scope: rebuild the deferred Cowork OnlyPreview when the standalone window closes, resuming the directory and file the window was showing through the existing first-restore path
status: pending
depends-on: [onlypreview-surface-ownership-136]
verify: node --test tests/onlypreview/onlyPreviewStandaloneCloseTakeover.test.mjs && node --test tests/onlypreview/onlyPreviewRestoreSelection.test.mjs && yarn typecheck:node && git diff --check
---

# The tab takes over when the window closes

## Objective

Owner decision, 2026-09-04: 「独立窗口的 only preview 关闭后捕捉到该事件就 tab 中如果打开了
onlypreview 就 reload tab 中的 onlypreivew … 能继续看之前看的文件，所以是 tab 要重新 load 下」 — when
the standalone window closes, a deferred Cowork tab rebuilds and continues on the same directory and
the same file.

## Contract

- The close of the standalone window is observed once, in one place, and promotes a `deferred` tab.
  Every close path must reach it: the Shell's own close button, the window's traffic light, a dead
  renderer (`closeOnRendererFailure`), `fileSearchWindowService.onUnexpectedExit`, and application
  quit — where promotion must **not** happen, because the whole app is going away.
- Promotion is a **fresh build**, not a hand-off. No workspace, selection or scroll state is
  serialised at close.
- Continuity comes from what already ships: `onlypreview_workspace / last_directory` and `last_file`
  are written continuously by `rememberSelectedFile` after a preview has presented, and
  `restoreFromStorage` applies them on a true first restore — which a newly built surface is. This
  task must not add a second restore channel. If a gap is found where the window's current directory
  or file was not yet persisted at close, fix the persistence, not the takeover.
- A remembered file that has since been deleted, or become a directory, still refuses per the
  existing contract, and the tab opens the Project with nothing previewed.
- A promotion while the Cowork window is hidden or its tab is in the background builds the surface
  and leaves it hidden; the container's visibility remains the host's business.

## Verification

- Close → promote for every close path listed above, and no promote on application quit.
- The rebuilt surface restores the last directory and the last file, using the existing restore
  service, and a stale remembered file degrades to "no preview" rather than an error.
- No second restore path is introduced: the takeover calls the existing first-restore route.
- Promotion is idempotent — two close events cannot build two composites.
