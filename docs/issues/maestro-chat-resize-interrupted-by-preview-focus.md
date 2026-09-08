# Maestro Chat resize stops when OnlyPreview takes focus

Status: implemented; owner testing pending (BL only)

## Evidence and root cause

Ral reports Cowork Control resizing works while Bitterless barely moves. The installed Preview
build 260908134246 and current source share the faulty path: a Chat width event updates the Home
placeholder, Main refreshes composite tabs, and OnlyPreview's bounds update reattaches its active
view. `ensureFocusedView()` checks only the preview container's children, so focused sibling Chat
looks like no focused content. It calls `focus()`, and BL's `onPanelBlur()` ends the drag.

A Node probe executing the real source functions with simulated native focus reproduced width
440 → 430, a focus claim, and no second width event. Cowork shares the narrow focus check but its
blur handler only clears the focus shadow, so the same probe continues to 400. Preview logs at
2026-09-08 15:23:36–15:23:58 Asia/Shanghai contain six `preview-focus-claimed` records; these support
the focus-stealing mechanism but do not independently record pointer movement.

## Required repair

- Change BL only; do not modify Cowork's working drag interaction.
- Ordinary preview geometry updates must not acquire keyboard focus. View attachment/replacement
  may recover otherwise missing focus, but must respect another focused WebContents (including
  sibling Chat and native PDF viewer contents) and must not focus a hidden preview surface.
- Match Cowork's gesture contract: blur changes the shadow only; pointerup, pointercancel,
  lostpointercapture, explicit close and unmount settle the drag. Keep pointer identity guards,
  screen-coordinate deltas, the 8px hit region and persistence only at gesture end.
- Preserve BL's existing 380–480px range/default480 and saved preferences. Its default already
  being the maximum is a separate behavior, not the cause of interrupted rightward shrinking.
- Retain standalone PDF focus recovery and existing Cmd+F / preview-search behavior.

## Verification plan

Use real-source Node tests across drag/focus/layout boundaries, with native Electron methods
stubbed: multiple moves with a loaded OnlyPreview tab; no focus claim on repeated bounds updates;
no stealing Chat/tree/search focus; hidden view protection; focus recovery on a fresh/replaced
preview when no WebContents owns focus. Cover blur continuation and every real terminal event.
Run targeted unit tests, Vue/TS compilation, scoped lint and diff checks. No Electron/E2E,
independent review, packaging, installation, synchronization or branch operation.

Owner acceptance: in an updated BL build, open a file in an OnlyPreview tab, drag Chat's left 8px
edge rightward from 480 toward 380 and back left without releasing. It must follow continuously;
release/reopen must retain the width. Check a normal web tab and standalone PDF Cmd+F too.

## Implementation and verification

BL Chat blur now changes only its focus shadow. Pointerup/cancel/lost-capture, close and unmount
still finish the gesture. OnlyPreview restores missing focus only when attaching a different view,
with live-host, visible-container/view, positive-bounds and global focused-WebContents checks;
ordinary bounds updates do not even query focus. No Cowork source or width configuration changed.

Passed 64 Node tests: 13 focused drag/focus checks and 51 existing preview-view, preview-region,
find and renderer-find regressions. The integrated test runs the real Control handlers, Home
layout store, preview view and layer service across widths 440 → 430 → 400 → 420, then blur and
another move to 380, with no preview focus claim and one settled preference write. Focus tests
cover fresh/replaced PDF recovery, Chat/tree/search/PDF-inner ownership, hidden surfaces, dead
hosts and empty bounds. Vue script/template, TypeScript and Less compilation, scoped ESLint and
diff checks passed. No Electron/E2E, independent review, packaging, installation or Git sync run.
