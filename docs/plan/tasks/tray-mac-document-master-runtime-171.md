---
id: tray-mac-document-master-runtime-171
scope: Bitterless macOS and Windows tray artwork and runtime assets
status: implemented; owner testing pending
depends-on: [tray-icon-refresh]
verify:
  - source-level tray asset contract test
  - generator syntax and scoped whitespace checks
---

# Selected cat artwork for macOS and Windows tray

## Objective

Use `doc/bitterless-tray-mac.png` as the exact macOS tray artwork in development and packaged
applications. On 2026-09-09, Ral requested regenerated assets that display at 24x24 on macOS.
Ral clarified that the existing icon looks too small: enlarge its logical width and height by 50%
from 16x16, preserving the existing cat artwork rather than redesigning it.
Keep the 208x208 master and generate 24x24 / 48x48 runtime representations from it.
Stop loading or packaging the retired `build/tray-mac@2x.png`.

On 2026-09-10, Ral selected the larger-feature generated cat-head image for an application trial
and requested the same artwork on Windows in its previous color. This selection supersedes the
earlier unchanged-master requirement. Archive the selected white-background input as
`doc/bitterless-tray-source.png`; convert white background/facial areas to transparency without
redrawing the selected geometry, then regenerate both platform assets.
The initial selected source had SHA-256
`b572dfbb51fcc7d2b780ce86bffd87bcc45bfad7be14cfb3d17eaeb9742d92e6`.

Later on 2026-09-10, Ral approved the preview with larger, raised eyes and requested the tray icon's
width and height reduced by 2px. Replace the selected source with that approved preview, regenerate
both platform masters and Windows ICO in the same tint, and reduce macOS logical size from 24x24
to 22x22 (22px / Retina 44px representations).
Current source SHA-256: `f6c83974d0314ce2ff129ae97829d5bbd9b3abf781283d3e6cb15883d08a4594`.

## Contract

- `doc/bitterless-tray-source.png` preserves the selected input image. The generated
  `doc/bitterless-tray-mac.png` is the 208x208 RGBA black artwork master.
- Generate `doc/bitterless-tray-mac-22.png` at 22x22 and
  `doc/bitterless-tray-mac-22@2x.png` at 44x44 with the same artwork and transparent background.
- macOS development loads the 22px base file; Electron loads the sibling `@2x` representation for
  Retina screens. Both represent a 22x22 logical image, with no runtime resize.
- macOS release packaging copies both runtime representations to `app.asar.unpacked/icons/`.
- Keep Template Image behavior so macOS supplies the visible menu-bar color.
- No runtime or packaging source references `build/tray-mac@2x.png`.
- Windows uses the same alpha geometry in `doc/bitterless-tray-win.png` with solid `#4E5882` color.
- Regenerate `build/tray-win.ico` with 16, 20, 24, 32, 40, 48, 64, and 256px representations.
- Update the runtime path and builder template to the 22px pair, retaining Template Image behavior.
  Retire the former 24px pair. Windows retains its system-selected ICO sizes. Application/Dock icons
  are outside this change.

## Verification

- Assert the master and both generated representations retain transparency and non-empty artwork;
  check generated dimensions and deterministic output against the master.
- Assert the builder template packages both representations under the runtime icon directory.
- Assert the tray helper resolves the 22px base in development and release, retains Template Image
  behavior, and does not shrink the generated image at runtime.
- Run the focused tray asset/packaging tests and generator syntax checks for this resource update.
- Do not launch Electron or run E2E; Ral owns visual testing.

## Larger raised eyes and 22px verification (2026-09-10)

- Replaced the selected source with the approved larger/raised-eye preview; both platform masters
  and all Windows ICO representations were regenerated with the existing tint.
- macOS runtime and builder-template paths now load 22px / Retina 44px resources. The old 24px pair
  was moved to a recoverable workspace temporary backup.
- Existing focused tray tests: passed, 5/5. Generator/test syntax and scoped whitespace checks passed.
- Inspected the resulting macOS/Windows images and light/dark small-size previews.
- Full-project typechecking, Electron/E2E, builds, and installation were not run. Ral owns the live
  test: restart a version containing these resources, check the approved eyes and 22x22 macOS tray,
  and confirm Windows keeps its Royal Blue tint.

## Previous selected-artwork verification (2026-09-10)

- Replaced both 208px masters and regenerated macOS 24px / 48px PNGs and all eight Windows ICO
  representations from the selected source, preserving its geometry and Windows `#4E5882` tint.
- `node --test scripts/package/trayIconContract.test.mjs`: passed, 5/5, including shared alpha,
  color, transparent cutouts, source provenance, deterministic generation, and packaging contracts.
- Generator/test syntax and scoped whitespace checks passed.
- Inspected both platform variants enlarged and at 24px on light/dark backgrounds.
- No application/runtime/packaging behavior was changed. Full-project typechecking, Electron/E2E,
  builds, installation, and live menu-bar testing were not run for this asset conversion.
- Human test: restart a version containing these resources on macOS and Windows; check the selected
  larger-feature cat, macOS Template Image appearance, Windows tint, and transparent backgrounds.

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
