---
id: eyes-on-agents-local-delete-098
scope: Remove a session mirror from Bitterless without changing Codex or Claude
status: implemented; owner verification pending
depends-on: [eyes-on-agents-card-context-menu-archive-071]
verify: repository, service, store and shared-menu contract tests plus EyesOnAgents strict typechecks; no Electron
---

# EyesOnAgents Local Delete

## Required behavior

- Every card's More and right-click menu includes **Delete from Bitterless**, including Codex,
  Claude, offline providers, and stale sessions no longer present in their source application.
- This is a separate local action, not Archive or a provider deletion. Do not invoke a provider,
  delete source files, change provider archive state, or create a native deletion tombstone.
- In one transaction remove the exact provider-qualified session's local thread, snapshot, Hook
  delivery receipts, and completion-alert receipts. Keep domains, provider configuration, other
  sessions, and Claude's native deletion evidence intact. Missing rows are an idempotent success.
- Return and broadcast the current snapshot after deletion. A failed write leaves the card and
  uses the existing action error. A stale pre-deletion snapshot response must not restore the card.
- Later provider discovery or a Hook may recreate the mirror. No permanent ignore list is added.

## UI

```text
… / right-click
  Open in Codex / Claude (when available)
  Mark as read / unread
  Copy session path (when available)
  ──────────────────────────
  Archive (Codex only)
  Delete from Bitterless
```

## Verification and handoff

Cover both providers, zombie/missing rows, exact-key isolation, dependent-row cleanup, no provider
mutation, rediscovery, menu parity, action failure, and stale snapshot overlap. Run targeted Node /
JSDOM tests and the Core/UI typechecks. Ral owns live/E2E testing; no independent review or Electron
launch is part of this task.

## Result

Implemented the independent typed API → Main → transactional repository action and both shared
menu entrances, with English/Chinese labels. Successful deletion invalidates older in-flight
snapshot responses; later fresh discovery remains allowed. Existing foreground-action mutual
exclusion is retained.

Code verification passed: repository/core suites; store + activation (41/41); menu interaction
(16/16); search/logo/connections (9/9); Core/UI strict typechecks; scoped `git diff --check`.
The menu + UI source aggregate passed 42/43; its sole failure is the unchanged Windows App ID
expectation in `ui-source.test.mjs:66`, unrelated to local deletion. No Electron E2E was run.

Human check: use More and right-click to remove a stale Codex/Claude card, and remove a live test
session mirror to confirm it remains intact in the source app. A later explicit sync may rediscover
it; this is expected, not a provider deletion failure.
