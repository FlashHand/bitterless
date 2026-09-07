---
id: onlypreview-workspace-folder-opens-preview-142
scope: Cowork's open_workspace_folder tool opens OnlyPreview instead of the OS file manager
status: implemented; owner manual verification pending
depends-on: [onlypreview-cowork-tab-mount-135]
verify: yarn test:onlypreview && yarn check:maestro && yarn build && git diff --check
---

# Show files in OnlyPreview, not in Finder

## Scope correction, 2026-09-07

**This task changed the wrong application for what the owner clicked.** The owner was running
`micromeet-cowork` and pressed its workspace chip — `apps/cowork/src/renderer/control/src/ChatPanel.vue:1065`,
`aria-label="Open workspace folder"`, `@click="revealWorkspace"` → `coach.openFile({ path })` →
`shell.openPath`. The string "Open workspace folder" exists **only** in that repository.

What this task changed is bitterless's Maestro **agent tool** of the same name
(`open_workspace_folder` in `workspaceFile.service.ts`). Same name, two different functions in two
different applications. The change below is still correct on its own terms — that tool did open
Finder in bitterless too — but it does not affect the button the owner pressed.

The cowork-side button is tracked in
`projects/micromeet-cowork/docs/features/onlypreview-miniapp.md` and depends on the port.

## Objective

Owner report, 2026-09-07: 「点击 Open workspace folder 打开的是文件浏览器不是 onlypreview，需要改」
— reported while running micromeet-cowork; see the correction above.

`open_workspace_folder` is an agent tool, and it was doing exactly what it was designed and
documented to do — `maestroSysPrompt.ts:19` said it "opens the workspace or a path inside it in
Finder/File Explorer". So this is a requirement change, not a defect: the app now has something
better than the OS file manager to show files in.

## What changed

Maestro may not import a preview application — `check:maestro`'s alias boundary — so the dependency
is inverted the same way the composite tab was:

| piece | side | knows |
| --- | --- | --- |
| `@maestro-shared/previewOpener.api.ts` | shared | `MaestroPreviewOpener` — `open(absolutePath)` plus a `displayName` for text shown to the owner |
| `previewOpener.registry.ts` | Maestro | one nullable slot. Null until a host registers |
| `workspaceFile.service.ts` `toolOpenWorkspaceFolder` | Maestro | asks the registry, falls back to the file manager when the slot is empty |
| `onlyPreviewMaestroOpener.ts` | host | registers OnlyPreview into the slot |
| `app.main.ts` | host | `registerOnlyPreviewMaestroOpener()` beside the composite-tab registration |

The host adapter is four lines because the seam it needs already existed:
`openRegisteredOnlyPreviewExplicitTarget` is described in its own file as "a one-slot indirection so
other subsystems can open a preview target without importing the window helper", and EyesOnAgents
already uses it. That route inspects the target, authorizes it, and opens the Project rooted at the
directory — selecting the file when the target was a file — so **both** target kinds work without a
new code path.

Three behavioural decisions worth stating:

- **A registered opener that fails is reported, not silently swapped for Finder.** Opening the wrong
  application is more confusing than an error message.
- **The file manager stays the fallback only when no opener is registered**, which is what this tool
  did before a preview application existed. A Maestro build without OnlyPreview still works.
- **A file target now opens in OnlyPreview too**, where it used to be revealed in Finder. That is
  the consistent reading of "show me this", and previewing a file is what OnlyPreview is for — but
  it is a wider change than the folder case the owner named, so it is called out here rather than
  buried. Say so if reveal-in-Finder should stay for files.

The three places that describe the tool to the model were updated with it —
`maestroSysPrompt.ts`, `fileTools.ts` (the tool schema description) and `hostToolCatalog.ts`
(the summary). Changing the behaviour without the prompts would leave the agent telling the owner it
opened Finder.

## Relationship to task 138

`onlypreview-cowork-workspace-preview-138` is the same intent through the *UI* affordance — clicking
the workspace path in the Control panel. It should route through this same registered opener rather
than adding a second path to OnlyPreview.

## Verification

Build clean, `yarn test:onlypreview` green, `check:maestro` gains no violation (my count stays 0;
the 29 it reports are pre-existing). **Runtime unverified by an agent** — the owner asked for manual
verification, and Electron E2E is not run here.

Owner check: in Cowork, ask the agent to open the workspace folder (or invoke
`open_workspace_folder`). Expect OnlyPreview rooted at that directory — in the Cowork tab or its own
window depending on the current host — and the agent's reply to say "in OnlyPreview".
