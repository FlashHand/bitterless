# OnlyPreview Embeddable Mount

Status: in progress — tasks 130, 131 and 135 implemented (owner manual verification pending); 132,
133, 134, 136, 137 and 138 pending. Electron E2E updated but not run by an agent.

Owner request, 2026-09-04: 「重大功能优化 bitterless 中的 only preview 需要改造成可以在子窗口
（webcontentsview 打开）这样可以实现 only preview 做成 miniapp 在 bitterless /cowork 浏览器中打开
也要能单独窗口打开 需要注意快捷键 视图层级的处理」

One OnlyPreview surface, two places it can live: its own window as today, or a `WebContentsView`
region inside the Maestro (Cowork) browser window, where it becomes a Mini App the owner opens in a
tab. Shortcuts and stacking are called out because they are the two things that are decided by the
window today and must be decided by the *host* afterwards.

## What OnlyPreview is today

Not one view. A **composite of four layered `WebContentsView`s** attached directly to a
`BaseWindow`'s `contentView`, ordered by one service:

| layer    | occupant                          | attached by                                                    |
| -------- | --------------------------------- | -------------------------------------------------------------- |
| `base`   | Shell (project rail, toolbar, status) | `onlyPreviewWindow.helper.ts` at window creation            |
| `main`   | Preview surface — Vue **or** raw Chromium | `onlyPreviewPreviewView.service.ts`                    |
| `global` | Global Search, transparent, covers the content rect | `onlyPreviewGlobalSearchView.service.ts`     |
| `alert`  | Alert / confirm / progress dialogs | `onlyPreviewAlertView.service.ts`                             |

`OnlyPreviewViewLayerService` owns the order and nothing else: every show re-adds every shown view
lowest-first, because `addChildView` is documented to reorder a view it already contains to the top
(`docs/features/onlypreview-view-layers.md`). Overlay layers deliberately do **not** occlude the
layers beneath them — Global Search is `setBackgroundColor('#00000000')` and floats in a gutter.

Three further facts decide the shape of this change.

**One live content host.** Every content-side service holds a single runtime —
`private runtime: … | null` in `onlyPreviewGlobalSearchView.service.ts:78`, the same in the alert and
preview-region services — and `hostToken` is a *capability guard* (`requireRuntime(hostToken)`), not
a multiplexer key. `onlyPreviewWindow.helper.ts` likewise holds one `baseWindow`, one `shellView`,
one `standaloneHost`. OnlyPreview supports exactly one live content surface at a time. The shared
search/index backend is not the constraint: `fileSearchWindow.service.ts` is one invisible renderer
whose grants and sessions are keyed per request, not per host.

**One layout choke point.** `OnlyPreviewWindowHelper.updatePreviewBounds`
(`src/main/windows/onlyPreviewWindow.helper.ts:528`) is the only place window geometry enters the
composite. The Shell renderer measures its own preview rect and reports it; Main clamps it against
`window.getContentSize()` and distributes three rects — the measured rect to the preview region,
`{0, 0, contentWidth, contentHeight}` to Global Search and to the alert layer. Every consumer already
works in **composite-relative** coordinates with the origin at the composite's top-left.

**The content services barely know about the window.** `onlyPreviewPreviewRegion`,
`onlyPreviewGlobalSearchView` and `onlyPreviewAlertView` each receive `window: BaseWindow` in their
runtime and use it for exactly one thing: `window.isDestroyed()` as a liveness probe
(`onlyPreviewPreviewRegion.service.ts:815`, `onlyPreviewGlobalSearchView.service.ts:339,360`,
`onlyPreviewAlertView.service.ts:467,485`). No geometry is read from it — that already arrives
through `updateBounds`. So the window leaves these three services by replacing one field with
`isHostLive: () => boolean`, not by rewriting them.

**Two shortcut carriers, already focus-scoped.** `bindNativeShortcuts` installs
`before-input-event` on each view's own `webContents`, so it fires only for the view that holds
keyboard focus — correct in any host. On macOS the Find chords additionally travel the application
menu, because AppKit resolves Command chords through the menu before the key window's first
responder and a `BaseWindow` of `WebContentsView`s has no guaranteed first responder
(`src/main/menu/applicationFindMenu.service.ts`). That menu path is the one place that asks "is the
focused window *my* window": `runMenuFindCommand` returns `false` when
`window !== this.baseWindow`, and an unclaimed chord is replayed to the focused `webContents` with
`sendInputEvent` so other windows keep their own Command+F.

## What the host already offers

The Maestro window is a `BrowserWindow` whose native views are laid out over rects the Home renderer
measures from placeholder elements:

- `MaestroWindowController.setViewBounds({ operation, control })`
  (`src/main/maestro/windows/main/maestroWindow.controller.ts:1608`) is authoritative once the
  renderer mounts; `layout()` covers the first frame with `TOOLBAR_H = 78`, `SIDEBAR_W = 480`.
  `opBounds` is remembered so a tab activated later lands in the same rect without waiting.
- A tab is an `OperationTab { id, kind, view: WebContentsView, url, title, favicon, pinned, … }`.
  Tab views are attached with `contentView.addChildView(view, 0)` — index 0 keeps every tab
  underneath the chrome — and start `setVisible(false)`; `activateTab` hides the outgoing view and
  shows the incoming one.
- `kind` already discriminates first-party tabs from web pages: the pinned local Home tab
  (`buildPinnedHomeView`, a bundled renderer with its own preload) and `ai-crms`.
- The Mini Apps grid inside Maestro is the same component as the Bitterless Home grid, and its
  OnlyPreview entry calls `onlyPreviewEmitter.openOnlyPreviewWindow()` today
  (`src/renderer/maestro/workbench/src/views/WorkbenchAppsView.vue:35`).

So the host can already supply a content rect, a z-order slot below its chrome, and an
activate/deactivate signal. What it cannot do today is host a tab whose content is more than one
`WebContentsView`.

## Verified Electron behaviour

The design rests on nesting native views, which this repository has never done — every existing
`addChildView` call targets a window's `contentView`. Measured directly on this project's Electron
40.10.6, macOS 25.4, with two headless probes:

| question                                                          | result                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Can a plain `View` parent a `WebContentsView`?                    | Yes. `container.children.length` tracks the adds.                                        |
| Does re-adding a child reorder it inside a container?             | Yes. `a,b` → re-add `a` → `b,a`. The layer service's primitive is unchanged by nesting.  |
| Are child bounds parent-relative?                                 | Yes. Moving the container from `(200,100)` to `(300,150)` left `a.getBounds()` at `(10,20,800,600)` untouched. |
| Does hiding the container hide its children?                      | Yes. Child page `document.visibilityState` → `hidden`, while the child's own `getVisible()` stays `true`. |
| Does a zero-size container hide rather than break its children?   | Yes — `hidden`, `isDestroyed() === false`.                                               |
| Can a container be re-parented between windows?                   | Yes. `win2.contentView.addChildView(container)` succeeded, source window's children → 0, child render process alive, DOM intact. |
| Are children clipped to the container rect?                       | **Not established.** A child sized past its container still lays out at its full size. The design therefore never relies on ancestor clipping. |

Two consequences worth stating plainly. Hiding the container is exactly the tab-switch primitive,
and it does not disturb per-layer visibility, so the layer service and the host cannot fight over
the same flag. And because a container survives re-parenting with its render process, the surface can
*move* between hosts without reloading — which is what makes one live surface a feature rather than a
restriction.

## The design

### The surface and the mount

Introduce two names.

An **`OnlyPreviewSurface`** is the composite: the container `View`, the four layers, the Shell view,
and the layer service instance that orders them. It knows its own size and nothing about windows.

An **`OnlyPreviewMount`** is what a host implements to carry a surface:

```ts
export interface OnlyPreviewMount {
  readonly kind: OnlyPreviewMountKind; // 'standalone' | 'cowork'
  attach(container: View): void;
  detach(): void;
  /** The composite's content size, in the surface's own coordinate space. */
  contentSize(): { width: number; height: number };
  /** Fires when `contentSize` changes for any reason the host knows about. */
  onResize(listener: () => void): () => void;
  /** Fires when the surface becomes / stops being the host's foreground content. */
  onActivation(listener: (active: boolean) => void): () => void;
  /** The window this surface currently lives in — for menu arbitration and parented dialogs. */
  window(): BaseWindow | null;
  /** Window-chrome capability, so the Shell renders the controls the host can honour. */
  readonly chrome: OnlyPreviewMountChrome; // { minimize, maximize, close, dragRegion }
  requestClose(): void;
  reportTitle(title: string): void;
}
```

`StandaloneOnlyPreviewMount` is today's behaviour, moved: it owns the `BaseWindow`, its
`WindowStateController`, bounds persistence, traffic lights, and `MIN_WIDTH`/`MIN_HEIGHT`.
`CoworkOnlyPreviewMount` is implemented on the Maestro side: it registers an `OperationTab` of a new
`kind: 'onlypreview'`, positions the container at `opBounds`, hides it with
`container.setVisible(false)` on tab switch, and maps `requestClose()` to closing that tab.

The direction of the dependency matters: OnlyPreview must not import Maestro. The mount interface
lives with OnlyPreview, Maestro implements it and hands it in — the same inversion the existing
`OnlyPreviewGlobalSearchWindowService` and `OnlyPreviewAlertWindowService` already use, where "the
helper owns the window and the view factory, the view service owns the dialog stack, and this binds
the two without either importing the other".

### Layering

`OnlyPreviewViewLayerService` keeps its algorithm exactly. Two changes:

1. `start(window)` becomes `start(container: View)`, and `resort()` calls
   `container.addChildView(...)` instead of `window.contentView.addChildView(...)`. Probe-verified
   to reorder identically.
2. It stops being a module singleton and becomes one instance per surface. The module export is
   retained only until the last call site moves, then deleted.

Inside the Cowork window the container sits where a tab view sits — `addChildView(container, 0)` —
so Maestro's chrome, control sidebar and menubar stay above the whole composite by construction, and
OnlyPreview's four layers can never interleave with Maestro's views. That is the entire z-order
story in embedded mode: **two independent stacks, one nested inside the other.**

The overlay layers are the part that needs care, because both were written as "covers the window
content rect". After this change they cover the *container* rect, which is what the existing
coordinates already say — the change is only where the numbers come from. And since ancestor clipping
is unverified, the surface asserts its own invariant: **every layer rect is contained in
`{0, 0, contentSize.width, contentSize.height}`.** `clampPreviewBounds` already does this for the
preview rect against the window's content size; the same clamp, fed by `mount.contentSize()`, now
covers all four layers, and a pure function makes it testable without Electron.

### Bounds

`updatePreviewBounds` swaps one expression: `window.getContentSize()` becomes
`mount.contentSize()`. Nothing downstream changes, because the preview region, Global Search and the
alert layer are already composite-relative.

In standalone mode `contentSize()` is the window's content size and a window `resize` listener
drives `onResize`. In Cowork mode it is `opBounds.width/height`, and `onResize` fires from the
existing `setViewBounds` report — the surface never learns that a sidebar or a tab strip exists.

### Shortcuts

Three carriers, each scoped by a different mechanism, and the important thing is that only one of
them is window-aware.

| carrier                                              | scope today                           | change |
| ---------------------------------------------------- | ------------------------------------- | ------ |
| `before-input-event` per view (`bindNativeShortcuts`) | the view that holds keyboard focus     | none — correct when nested, and an inactive tab's views are hidden so they cannot hold focus |
| macOS application-menu accelerator (Command+F, Shift+Command+F) | `window !== this.baseWindow` → not mine | must resolve through the surface registry instead of a window field |
| renderer keydown inside the Shell                     | the Shell's own DOM                    | none |

The menu path becomes: given the focused `BaseWindow` and the focused `webContents`, find the live
surface that should receive this chord —

1. the focused `webContents` belongs to one of the surface's four views → that surface; else
2. the focused window is the surface's mount window **and** the surface is the mount's active
   foreground content → that surface; else
3. no surface claims it, and the existing replay to the focused `webContents` runs unchanged.

Rule 1 alone handles most cases and is host-agnostic. Rule 2 is what makes Command+F work when the
OnlyPreview tab is active but focus sits in Maestro's address bar or nowhere at all — without it the
chord would be replayed into the address bar. Rule 3 is why Maestro's own Command+F (find in page)
and every other window's keep working: an unclaimed accelerator is still re-delivered.

The collision list, resolved by that order: **Command+F** — OnlyPreview find-in-file when an
OnlyPreview view or the active OnlyPreview tab has it, otherwise Maestro's find-in-page.
**Shift+Command+F** — OnlyPreview Global Search, unclaimed elsewhere. **Command+W / Command+T /
Command+L / Command+R** — always Maestro's, never claimed by OnlyPreview; in embedded mode
Command+W must close the *tab*, which is `mount.requestClose()`, not the composite's own teardown.
The delete, copy-path and copy-name chords stay on `before-input-event` and so are already
focus-scoped. The DevTools chord stays gated on the debug/E2E predicate it has today.

One rule that is easy to get wrong and cheap to state: a hidden container's views cannot hold focus,
so an OnlyPreview surface in a background tab receives no chords through any carrier. No
"is my tab active" check is needed in the per-view path.

**The mechanism for claiming a chord is `event.preventDefault()` on `before-input-event`**, which
Electron documents as suppressing the menu shortcut as well as the page. So OnlyPreview needs no
change to the application-menu template, and in particular must not rewrite `{ role: 'fileMenu' }`
or `{ role: 'viewMenu' }` into hand-written item lists — that would re-scope Command+W and
Command+R for every Bitterless window (Home, Omni, EyesOnAgents, Submodules, Todo) for a two-host
benefit. `webContents.setIgnoreMenuShortcuts` is likewise **rejected**: it exists, is unused
anywhere in `src/`, and applying it to the composite's views would disarm Find and Find-in-Project
on exactly the out-of-process PDF frame that made the menu accelerator necessary in the first place.

**Command+W has a hole, and it is not OnlyPreview's.** Maestro installs its tab chords in
`src/main/maestro/common/shortcutsHelper/shortcuts.helper.ts`, and the gate is
`if (contents.session !== session.fromPartition(MAESTRO_PARTITION) || shortcutContents.has(contents))
return`. OnlyPreview's views are created with **no `partition`**
(`onlyPreviewWindow.helper.ts` `createView`), so they run in the default session and Maestro's
handler skips them. With focus inside an embedded OnlyPreview view, Command+W therefore reaches
neither Maestro's `closeActiveTab` nor any OnlyPreview binding, and falls through to the inherited
`fileMenu` `close` role — **closing the whole Cowork window instead of the tab.**

The fix belongs on the Maestro side and is one file: a module `WeakSet` plus an
`enrollMaestroShortcutContents(contents)` entry point, and widening that gate to admit enrolled
contents. The Cowork mount enrolls each of the composite's views as it creates them. Keeping the
partition test as the default is deliberate — it is what stops arbitrary web content in a tab from
claiming Bitterless chords.

**Nothing in this design moves OnlyPreview into `MAESTRO_PARTITION`.** The composite keeps the
default session, its own `bitterless-preview://` protocol registration and its sandboxed content
preload, so an embedded OnlyPreview shares no cookies, storage or service workers with the remote
pages in sibling tabs. Enrollment grants a keystroke, not a session.

**A `BaseWindow` of views can have no focused child at all**, which is the case the existing
diagnostics were added to distinguish, and a detached DevTools window takes key status while binding
both Find chords itself. Both are handled by having the mount claim keyboard focus for the
composite's own preferred view — on mount, on activation, and immediately after
`openDevTools({ mode: 'detach', activate: false })`.

### Explicit host toggle

The MenuBar carries one 27px Tabler button immediately right of Settings in either host. In a tab,
`IconExternalLink` offers moving to a separate window; in a window, `IconBrowser` plus a subtle
selected tint offers moving back into the existing browser. Its localized tooltip/accessible name
identifies the action and its availability; absent browser and in-flight relocation disable it.

This is the explicit serialized relocation in [task 139](../plan/tasks/onlypreview-host-toggle-139.md),
not the still-planned automatic priority/placeholder arbiter below. It disposes the old mount and
rebuilds the destination. Existing persistence restores the Project, and a bounded Main-authority
target descriptor may preserve an explicitly selected external file through reauthorization on
the new host. No renderer-supplied paths, old capabilities, file bytes or live views cross mounts;
no container re-parenting or extra file-I/O pipeline is introduced.

### Focus and MenuBar chrome

The Shell already receives the immutable `window | cowork` host kind. Only a standalone macOS
window reserves the 78px traffic-light gutter; a Cowork tab keeps the normal 10px MenuBar gutter.
The Open folder action is icon-only with a localized tooltip/accessibility label and a centered
27px square target in either host. See [MenuBar alignment 144](../plan/tasks/onlypreview-tab-menubar-alignment-144.md).

Focus questions are asked of the **surface's own views**, never of the window's children. This is
not a preference: with a container in place a window holds exactly one child, and a plain `View` has
no `webContents`, so a window-level "is anything of mine focused?" scan finds nothing and always
answers no. `OnlyPreviewPreviewViewService.ensureFocusedView` was exactly that scan — it only claims
focus "when nothing else has it, so navigating the Project tree by keyboard or by click keeps its
focus" — and against a container it would have claimed focus on **every** selection and broken the
tree. It now scans `container.children`, which is precisely this surface's four layers, and is
correct in both mounts.

The same rule applies to the E2E harness: `tests/onlypreview` reached for
`window.contentView.children` in eleven places and read `.webContents` off each child, which throws
on a container. All eleven now descend through any child that is not itself a web view, so a flat
window and a nested one return the same list.

### Overlays

Both overlays are already child views in layers, not windows — the `*Window.service.ts` files are
binding seams, not window owners. So neither becomes a child window, and modality keeps working the
way it does today: `executeNativeCommand` already swallows Find and Global Search while the alert
layer is open — and that swallow widens to **every** native command while a dialog is visible, since
a dialog is modal to the composite and no chord should act behind it. In embedded mode "modal" means modal to the composite, not to the Cowork window —
the owner can still switch tabs with a confirm dialog open, and the dialog is still there when they
come back, because hiding the container preserves per-layer visibility.

Settings and the Agent Skill guide stay separate `BrowserWindow`s. They take their parent from
`mount.window()` instead of `this.baseWindow`.

### Chrome and window commands

`minimizeWindow`, `toggleMaximizeWindow` and `closeWindow` currently call
`requireStandaloneWindow(hostToken)`. They route through the mount instead, and the Cowork mount
declares `minimize: false, maximize: false, close: true` so the Shell renders only what the host can
honour. The Shell learns this the same way it learns everything else about its host — a new
`--onlypreview-chrome=window|cowork` additional argument surfaced on `onlyPreviewEnv`
(`src/preload/onlypreview/onlyPreviewEnv.preload.ts`), which is already how `hostToken`, `hostId`,
`mode` and `platform` arrive. No new IPC.

### Lifecycle, ownership and identity

`hostToken` stays the identity of a surface, and the host registry stays the authority. The window
helper's single-surface fields (`baseWindow`, `shellView`, `standaloneHost`) become a
`Map<hostToken, OnlyPreviewSurface>`, because two *surfaces* now exist even though only one of them
is ever a live composite.

Owner decision, 2026-09-04: 「独立窗口的 OnlyPreview 和 Cowork 里的 OnlyPreview tab，不能同时开，如果
独立窗口 tab 里的 onlypreview 就显示 view in window 点击聚焦 独立窗口的 onlypreview。独立窗口的
only preview 关闭后捕捉到该事件就 tab 中如果打开了 onlypreview 就 reload tab 中的 onlypreivew，例如
独立窗口打开的目录和正在看的文件，在独立窗口关闭 tab 中打开，能继续看之前看的文件，所以是 tab 要
重新 load 下」

**Exactly one live OnlyPreview content surface, and the standalone window has priority.** A Cowork
OnlyPreview tab is therefore in one of two states:

| state      | what the tab holds                                                        |
| ---------- | ------------------------------------------------------------------------- |
| `live`     | the composite — container, four layers, a bound workspace                 |
| `deferred` | one placeholder view: the OnlyPreview identity and a **View in window** action that shows and focuses the standalone window |

| event                                                                              | tab is `live`                                            | tab is `deferred`                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------- |
| the standalone window opens (Home Mini Apps, OS file-open queue, agent/MCP preview) | the tab disposes its composite and becomes `deferred`    | unchanged                                |
| the standalone window closes                                                        | —                                                        | the tab builds a fresh composite → `live` |
| OnlyPreview is opened from Cowork's Mini Apps grid, standalone window open          | —                                                        | the tab is activated, still `deferred`   |
| OnlyPreview is opened from Cowork's Mini Apps grid, no standalone window            | the tab is activated                                     | (no such tab yet) a `live` tab is created |
| the tab or the Cowork window closes                                                 | the composite is disposed                                | the placeholder is disposed              |

The takeover on standalone close is a **fresh build, not a hand-off**, and that is what makes the
owner's requirement work rather than a special case for it. OnlyPreview already persists the Project
directory and the file being previewed continuously — `onlypreview_workspace / last_directory` and
`last_file`, written by `rememberSelectedFile` *after* the preview has presented
(`docs/features/onlypreview-restore-last-previewed-file.md`) — and `restoreFromStorage` runs on a
true first restore, which a newly built surface is by definition. So a tab that takes over reopens
the directory and the file the window was last showing through the shipped restore path, with no
new hand-off channel, no state serialisation at close, and no risk of a half-transferred workspace.

Two consequences to hold on to. Because the tab is disposed rather than hidden while the window
owns the surface, there is never a second bound workspace, a second index watcher, or a second find
session — which is why the content services can keep their single runtime. And because the
placeholder is a real occupant of the composite's `base` layer, the same container and the same
layer service carry both states: `hide('base', 'deferred')` then `show('base', 'shell', shellView)`
is the whole takeover, with `OnlyPreviewViewLayerOwner` gaining `'deferred'`.

Rejected here: re-parenting the live container from the window into the tab. It is technically
available — a container survives a move between windows with its render processes intact — but it
hands the owner a surface whose window controls, chrome and geometry all changed under it, and it
makes the tab's state depend on how it was reached. A fresh build plus the existing restore path
gives the same continuity with none of that.

## What does not change

The whole OnlyPreview feature contract: browsing, the project rail and its persisted width, the
preview surfaces (Monaco, Markdown, XLSX, DOCX, PPTX, Draw.io, image, audio, video, PDF, contained
HTML), Global Search, alert dialogs and delete progress, browse history, find-in-file, the
`bitterless-preview://` protocol and its session, the invisible `fileSearch` renderer and its
capability model, and every XPC contract. Standalone mode keeps its window state, bounds
persistence, minimum size and traffic lights.

## The contract this amends

This request reverses a delivered decision, and the reversal has to be written down rather than
assumed. `docs/features/onlypreview.md` carries a **Standalone-only boundary** section:

> OnlyPreview is not an Omni mini app. Its usable surface owns a native `BaseWindow` graph
> containing one Shell and one mutually exclusive Preview Region content view plus its app-specific
> Setting window. Omni must not list `onlypreview`, accept it in persisted cell state, map it to a
> runtime target, or load an OnlyPreview preload. There is no embedded DOM Preview adapter or
> container mode.

`onlypreview-standalone-only-002` (done) removed OnlyPreview from Omni on purpose after the MVP had
embedded it, and `tests/onlypreview` plus focused Omni tests assert that
`parseOmniMiniAppId('onlypreview')` throws. There is also an owner-deferred task recording this same
intent for a different host: `docs/plan/tasks/onlypreview-omni-embedding-026.md`, "deferred by owner
2026-08-21 — do not implement yet", which names the identical hard parts and this identical conflict.

What this feature does and does not disturb:

| the boundary says | this feature |
| --- | --- |
| Omni must not list `onlypreview`, accept it in cell state, map it to a runtime target, or load its preload | **unchanged.** The host here is Maestro/Cowork, not Omni. `OmniMiniAppId` gains nothing, and `parseOmniMiniAppId('onlypreview')` keeps throwing. |
| "There is no … container mode" | **amended.** There is one: a container `View` the composite owns, mounted either in its own window or in a Cowork tab. |
| "There is no embedded DOM Preview adapter" | **unchanged, and deliberately so.** Nothing is collapsed into a DOM surface; the four native layers stay four native layers. |
| the surface "owns a native `BaseWindow` graph" | **amended.** It owns a native *view* graph; a window is one of two things that can carry it. |

`onlypreview-omni-embedding-026` stays deferred and is **not** superseded: the owner asked for
Cowork, not Omni. What changes for it is that its first open question — "does the embedded form
collapse the renderers, nest child views in the cell, or embed a preview-only surface?" — is now
answered by this design (nest, behind a mount), so if the owner ever un-defers it, Omni becomes a
third `OnlyPreviewMount` implementation rather than a rewrite.

## How Cowork carries it

Maestro must not import a mini app. `scripts/maestro/_harness.mjs` enforces that with an alias
boundary — no `@main/*`, `@shared/*` or `@renderer/*` specifier inside `src/main/maestro/**` or
`src/renderer/maestro/**` unless it is on an explicit per-file allowlist — and a host mini-app
integration is exactly the crossing that should be inverted rather than allowlisted.

So Maestro offers a **generic composite tab** and knows nothing about OnlyPreview:

| piece | side | what it knows |
| --- | --- | --- |
| `@maestro-shared/compositeTab.api.ts` | shared | `MaestroCompositeTabHostApi` (window, contentRect, attach/detach, activate, close, setTitle, isOpen) and `MaestroCompositeTabSpec` (open/close/setActive/refresh) |
| `compositeTab.registry.ts` | Maestro | a `Map` of registered specs. Empty until a host registers one |
| `maestroBrowserView.openCompositeTab({ id })` | Maestro | how to carry *a* container in *a* tab |
| `onlyPreviewCoworkMount.ts` | host | implements `OnlyPreviewMount` on top of `MaestroCompositeTabHostApi` |
| `onlyPreviewCoworkTab.ts` | host | registers the spec; the only file that knows both halves |
| `app.main.ts` | host | calls `registerOnlyPreviewCoworkTab()` before `startGui()` |

The tab holds the composite's container with `view: null`, and that null is load-bearing twice:
`enforceWarmCap`'s `warm` filter counts only tabs with a live `view`, so a composite tab can never
be cooled — cooling would detach the container while orphaning four renderers, the hidden
`fileSearch` runtime, the bound workspace and the host capability — and the tab-strip persistence
writer filters to `kind === 'browser'`, so a URL-less tab is never saved or restored as a broken web
tab. Both checked in the source, not assumed.

`MAESTRO_TOOLBAR_H`/`MAESTRO_SIDEBAR_W` and a first-frame rect helper moved into `viewBounds.ts`,
which both sides already import, because a composite tab cannot wait for the renderer's first
measurement the way a loading web page can: with no rect the container gets no bounds, and a
zero-size container hides its children, so the mini app would open to nothing.

## How this is verified without Electron E2E

Agent-initiated Electron E2E is prohibited in this project, so the non-E2E proofs have to be the
load-bearing ones:

- `yarn test:onlypreview` — the ~100-file node suite. It had **no aggregate script** before this
  feature; a task could pass its own focused `verify` line while breaking the rest of the domain.
- `yarn typecheck` (`typecheck:node` + `typecheck:web`), `yarn lint`, `yarn check:renderer-i18n`,
  `yarn check:maestro`.
- `yarn build` — the strongest available structural proof. `electron.vite.config.ts`'s `closeBundle`
  re-reads every `out/renderer/onlypreview/<mode>/index.html` and enforces CSP and charset ordering,
  the `wasm-unsafe-eval` present/absent split per entry, and the Monaco bootstrap hash. Renderer-entry
  drift is invisible to node tests and caught here.
- An **import-direction guard**: no file under `src/main/onlypreview/` may import `@maestro*`. The
  dependency rule is stated in this document and is otherwise unenforced.
- A **containment property test** over (composite extent × reported preview rect) asserting every
  layer rect lies inside `{0, 0, width, height}` — the invariant that stands in for the ancestor
  clipping this design refuses to rely on.
- The E2E specs are updated with the code but **not run by an agent**. They are handed to the owner.

Two facts worth recording because they were checked rather than assumed:
`src/renderer/onlypreview/globalSearch/index.html` carries `script-src 'self' 'wasm-unsafe-eval'`
while `alert/index.html` carries `script-src 'self'; connect-src 'none'`, which is an independent
reason not to fold either into the Shell; and `scripts/renderer-i18n/check-renderer-i18n.mjs` never
listed the `alert` or `globalSearch` entries, so its inventory needs no edit for this work.

## Rejected alternatives

**Attach the four layers straight into the Cowork window as siblings of its tab views.** Interleaves
two independent stacks in one ordered list, so every Maestro tab activation and every OnlyPreview
re-sort would have to agree about the other's layers. This is precisely the failure the layer service
was built to end — "every view raises itself, so no code owns the resulting order."

**Collapse Shell + Global Search + Alert into one renderer so a tab is one `WebContentsView`.**
Tempting, and it would make embedding trivial, but it discards deliberate separations: the alert
layer's dialogs are separate so they survive Shell reloads and can sit above a raw Chromium preview
that the Shell's DOM cannot reach over; Global Search is a separate renderer so it can be preloaded
without contending with the Shell's first paint (`reportShellMounted`). Nesting costs one container
`View`; this costs a rewrite of three renderers and loses two properties.

**Give Cowork a generic "composite tab" API.** Speculative. One host, one composite, one seam; a
second composite mini-app can generalise it with evidence.

## Pending questions

| id   | question | why it is parked | default if unanswered |
| ---- | -------- | ---------------- | --------------------- |
| PQ-1 | ~~Can a standalone window and a Cowork tab show OnlyPreview at the same time?~~ | **Answered by the owner, 2026-09-04: no.** The standalone window has priority, the tab shows a **View in window** placeholder, and on standalone close the tab rebuilds and resumes from the persisted directory and file. See *Lifecycle, ownership and identity*. | — |
| PQ-2 | Does the Cowork OnlyPreview tab appear as an ordinary closable tab, or as a second pinned tab next to local Home? | Product placement. | Ordinary closable tab, opened from the Mini Apps grid. |
| ~~PQ-3~~ | ~~Should an agent/MCP `preview_open` or an OS file-open land in the Cowork tab, or open the standalone window and demote the tab?~~ | **Superseded by the owner's 2026-09-07 requirement** that OnlyPreview reopen in whichever host it was last opened in. The remembered host now decides for *every* route, external opens included — see [`onlypreview-remembered-host-140`](../plan/tasks/onlypreview-remembered-host-140.md). | — |
