# Trench Tab and Window Hosting

Status: implemented; live Electron acceptance pending

## Contract

- The ordinary Trench surface can live in a Maestro tab or a separate window. There is at most
  one ordinary Trench WebContents, including while opening or switching hosts.
- Ral's clarification: Omni remains independently embedded and permits multiple Trench renderers
  for simultaneous monitoring panels. Omni is explicitly outside the ordinary-surface singleton.
- Maestro Home and Workbench open the Trench tab. The standalone Mini Apps entry opens a window
  when absent, otherwise focuses the existing ordinary surface without making another one.
- A Settings-right header icon moves the ordinary surface between tab and window. Omni does not
  show this control. A missing Maestro window disables docking with a clear tooltip.
- The same WebContentsView moves between carriers; selected module, drafts and loaded data survive
  the move. The old carrier is detached before the new carrier owns the view. This differs from
  OnlyPreview's multi-renderer teardown/rebuild, while using the same composite-tab host API.
- Closing the active carrier destroys its ordinary renderer. Closing an old carrier after a move
  cannot destroy the new owner. Logout and app quit destroy the managed surface and prevent opens.
- Tab bounds follow Maestro's content rectangle; inactive tabs hide. Window bounds retain the
  existing `coin` window-state key. Embedded headers have no traffic-light inset or drag region.
- Existing default-session, sandbox, navigation, main-frame and live-renderer checks stay intact.
  Host-toggle requests require the ordinary surface token; Omni cannot move another surface.
- Hidden Trench I/O and background monitoring are not display renderers and are not stopped by a
  host move. No trading, storage, provider or Omni session policy changes are included.

## Verification

Focused lifecycle/host tests, Trench sender tests, affected typechecks and build. Ral owns live
Electron testing; no Electron E2E or independent review is run for this task.

2026-09-08: 20 host/lifecycle/sender tests, 76 monitoring tests and 5 Omni source-contract tests pass.
Trench renderer typecheck, scoped ESLint, renderer i18n and `git diff --check` pass. Full build is
blocked by unresolved `typebox` in the concurrently changing `maestro-agent-sdk/runtime/piRuntimeAdapter.ts`.
Main typecheck reports unrelated existing/transitive errors; `check:maestro` stops on the concurrently
removed `src/main/agent/BaseAgent.ts`. Neither is reported as passing. The Omni build-artifact test
cannot pass against the stale output and is excluded from the separate source-contract run.
