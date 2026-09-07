---
id: onlypreview-remembered-host-140
scope: remember which host OnlyPreview was last opened in and make that the default target for every open route
status: pending
depends-on: [onlypreview-surface-ownership-136]
verify: node --test tests/onlypreview/onlyPreviewRememberedHost.test.mjs && yarn typecheck:node && git diff --check
---

# Open where it was last opened

## Objective

Owner request, 2026-09-07: 「onlypreview 要记住上次打开的方式 下次要使用上次打开的方式」 — remember
whether OnlyPreview was last in its own window or in a Cowork tab, and open it there next time.

## Contract

- **Remember the host the surface was actually built in, not the one that was asked for.** By the
  same rule `rememberSelectedFile` follows — it writes only after the preview has actually presented
  — a request that failed, or that fell back to another host, must not become the remembered choice.
- **Every open route takes the remembered host as its default target.** The route's own context
  stops deciding. This is the point of the requirement: opening from the Bitterless Home grid while
  the remembered host is `cowork` lands in the Cowork tab, and opening from Cowork's Mini Apps grid
  while the remembered host is `window` raises the window.
- **Fallback is a window, and it is silent.** Remembered `cowork` with no Cowork window running
  opens the standalone window; it must never fail, and must never launch Cowork by itself — the same
  rule task 139 settled for the toggle. A fallback does **not** overwrite the remembered host: the
  owner's last deliberate choice survives a session where Cowork happened not to be running.
- **The toggle is the writer.** Task 139's control is how the owner changes hosts deliberately, so it
  writes this record; the preference and the toggle cannot disagree because there is one writer and
  one reader. A relocation driven by the ownership arbiter (task 136) writes it too, for the same
  reason: it is a host change that actually happened.
- **No route may block on reading it.** See the storage note below.
- First run, or an unreadable/unrecognised record, resolves to `window`.

## Storage

`onlypreview_settings / preferences` is the obvious home and is probably the wrong one. It is read
through the `SettingDao` XPC emitter into the hidden sqlite renderer, and
`onlyPreviewSettings.service.ts:15-16` wraps that read in a readiness retry of **26 attempts at
200ms — up to 5.2 seconds**. The remembered host has to be known *at open time*, which is before any
OnlyPreview surface and, on a cold launch, potentially before sqlite is ready. An open path that
awaits it would stall the very action the owner just took.

So: a Main-owned record, read synchronously at open time, in the shape `windowState.service.ts`
already proves works — `join(app.getPath('userData'), <file>.json)`, no sqlite, no renderer, no
retry. `windowStateService` is the precedent, not the container: this is not window geometry, so it
does not belong inside `window-state.json`.

If it is put in `onlypreview_settings` instead, the open path must read it opportunistically —
cached value or nothing — and never await the retry. State whichever is chosen in the code, with the
reason, because the failure mode of getting this wrong is a five-second stall on a click.

## Supersedes

`docs/features/onlypreview-embeddable-mount.md` PQ-3 defaulted to "an explicit external open (OS
file-open, agent/MCP `preview_open`) goes to the standalone window and demotes the tab". That
default no longer holds: the remembered host decides for **every** route, including those. Amend the
ledger entry rather than leaving two rules that contradict each other.

## Verification

- The record is written only after a surface is built, and not on a failed or fallen-back open.
- Each open route resolves its target from the record; a survey of the routes is the input to this
  test, so the test enumerates them explicitly rather than testing one and assuming the rest.
- Remembered `cowork` with no Cowork host: opens a window, and the record still says `cowork`.
- First run and a corrupt record both resolve to `window`.
- No open path awaits the sqlite readiness retry — asserted, because this is invisible until it is
  slow on someone's cold start.
