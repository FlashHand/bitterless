/**
 * The literal KDL Bitterless seeds into `<userData>/zellij/config.kdl` on first run.
 *
 * Kept as text in its own file so the config reads as the config — a KDL document you can copy into
 * a terminal and validate — instead of being buried in the string concatenation that builds it.
 * Everything here came from `zellij setup --dump-config` of the bundled 0.45.1 binary, and
 * `zellijDefaultConfig.test.mjs` feeds the composed result back to that binary rather than trusting
 * it by eye.
 */

/** The theme this app defines and selects. Per app, so two installs never argue over one name. */
export const ZELLIJ_THEME_NAME = 'bitterless';

/**
 * Replaced with the binds derived from `defaultZellijShortcuts`.
 *
 * A placeholder rather than literal binds: hand-written keys here would be a SECOND source of truth
 * and would read back as drift the first time the settings panel opened.
 */
export const ZELLIJ_BINDS_PLACEHOLDER = '{{BINDS}}';

/**
 * Colours are SPACE-SEPARATED RGB TRIPLES. A hex string parses as valid KDL and is then rejected by
 * Zellij, so this is the one detail here that cannot be checked by reading.
 */
export const ZELLIJ_DEFAULT_CONFIG_TEMPLATE = `// Written by Bitterless on first run. Yours to edit — it is never rewritten.
//
// These shortcuts are also editable from the terminal's settings panel, which performs a surgical
// edit of this file and leaves everything else byte for byte.

keybinds {
  normal {
${ZELLIJ_BINDS_PLACEHOLDER}
  }
}

// Without an explicit theme every cell renders in the default foreground — which is how "all output
// is white" happens. A browser tab is not a terminal emulator and has no palette for Zellij to
// inherit, so all sixteen slots are defined here rather than styled around on the page.
themes {
    ${ZELLIJ_THEME_NAME} {
        fg 216 222 233
        bg 26 27 38
        black 26 27 38
        red 247 118 142
        green 158 206 106
        yellow 224 175 104
        blue 122 162 247
        magenta 187 154 247
        cyan 125 207 255
        white 192 202 245
        orange 255 158 100
    }
}

theme "${ZELLIJ_THEME_NAME}"

// The host "terminal" is a browser tab and never reports a palette, so pin the appearance rather
// than wait for a report that will not arrive.
explicit_theme_hue "dark"

// The full layout (tab bar + status bar), not "compact": the pane shortcuts above are discoverable
// from the status bar, and this surface offers no other place to show them.
default_layout "default"
`;
