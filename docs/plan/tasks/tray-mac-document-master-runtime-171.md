---
id: tray-mac-document-master-runtime-171
scope: Bitterless macOS tray runtime asset source
status: implemented; owner testing pending
depends-on: [tray-icon-refresh]
verify:
  - source-level tray asset contract test
  - node typecheck
---

# Use the macOS tray documentation master at runtime

## Objective

Use `doc/bitterless-tray-mac.png` as the exact macOS tray artwork in development and packaged
applications. On 2026-09-09, Ral requested regenerated assets that display at 24x24 on macOS.
Ral clarified that the existing icon looks too small: enlarge its logical width and height by 50%
from 16x16, preserving the existing cat artwork rather than redesigning it.
Keep the 208x208 master and generate 24x24 / 48x48 runtime representations from it.
Stop loading or packaging the retired `build/tray-mac@2x.png`. Windows tray behavior is unchanged.

## Contract

- `doc/bitterless-tray-mac.png` remains the unchanged 208x208 RGBA artwork master.
- Generate `doc/bitterless-tray-mac-24.png` at 24x24 and
  `doc/bitterless-tray-mac-24@2x.png` at 48x48 with the same artwork and transparent background.
- macOS development loads the 24px base file; Electron loads the sibling `@2x` representation for
  Retina screens. Both represent a 24x24 logical image, with no runtime resize.
- macOS release packaging copies both runtime representations to `app.asar.unpacked/icons/`.
- Keep Template Image behavior so macOS supplies the visible menu-bar color.
- No runtime or packaging source references `build/tray-mac@2x.png`.
- Windows continues to use `build/tray-win.ico`.

## Verification

- Assert the master and both generated representations retain transparency and non-empty artwork;
  check generated dimensions and deterministic output against the master.
- Assert the builder template packages both representations under the runtime icon directory.
- Assert the tray helper resolves the 24px base in development and release, retains Template Image
  behavior, and does not shrink the generated image at runtime.
- Run `yarn typecheck:node`.
- Do not launch Electron or run E2E; Ral owns visual testing.

## Previous verification result (16x16 implementation)

- `node --test scripts/package/trayIconContract.test.mjs`: passed, 3/3.
- `yarn typecheck:node`: blocked by 73 existing diagnostics outside the tray change; the focused
  Main diagnostic listing contains no error from `src/main/tray/tray.helper.ts`.
- Electron, E2E, packaging, and live tray inspection were not run; Ral owns the visual check.

## Reference

- [Electron high-resolution images](https://www.electronjs.org/docs/latest/api/native-image#high-resolution-image):
  load the base filename with a sibling `@2x` representation for Retina screens.

## 24x24 verification

- Regenerated the 24px / 48px PNGs; the 208px artwork master remains byte-for-byte unchanged.
- `node --test scripts/package/trayIconContract.test.mjs`: passed, 4/4.
- Generator syntax and scoped whitespace checks passed.
- `yarn typecheck:node`: exited 1 with 90 distinct current project diagnostics across 22 surfaces
  (82 on Main); three preload surfaces are quarantined by the existing runner. Full-project
  typechecking did not pass; no before/after baseline or per-file diagnostic attribution is claimed.
- Inspected an actual-size 16px / 24px comparison: the same cat artwork is visibly larger.
- Human test: restart a version containing this change and check that the macOS menu-bar cat is
  larger, crisp on Retina, and visible on light/dark menu bars. Electron/E2E, packaging, installation,
  and live menu-bar verification were not run.
