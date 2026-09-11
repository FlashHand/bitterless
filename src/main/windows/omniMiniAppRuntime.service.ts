import type { OmniMiniAppId } from '@shared/omni/omni.types';

/**
 * A cell that loads a first-party renderer bundle from `out/renderer/<name>/index.html` with a
 * privileged preload. This is what every mini app was before Zellij.
 */
export interface OmniRendererMiniAppRuntime {
  kind: 'renderer';
  preloadFile: string;
  rendererName: string;
  sandbox: boolean;
}

/**
 * A cell that loads a LOCAL SERVER ORIGIN instead of a bundled page — no preload at all, and its own
 * session partition so its cookies never touch the app's.
 *
 * Zellij needs this because its content is `http://127.0.0.1:<port>` served by the bundled zellij
 * binary, which the renderer-bundle shape simply cannot describe: `resolveMiniAppRuntime` asserts a
 * local preload and a local `index.html` exist, and the cell's navigation fence pins the URL to
 * exact equality. Both assumptions are wrong for a server origin whose port is per-environment.
 */
export const OMNI_ORIGIN_SOURCES = ['zellij'] as const;
export type OmniOriginSource = (typeof OMNI_ORIGIN_SOURCES)[number];

export interface OmniOriginMiniAppRuntime {
  kind: 'origin';
  /**
   * A NAME, not the origin itself. This module must stay free of value imports — it is loaded
   * directly by the Omni embedding tests with Node's ESM loader, which does not resolve the `@main`
   * alias, so pulling in the zellij runtime here breaks them (and would make a declarative registry
   * depend on a process manager). `omniWindow.helper.ts` maps the name to a live origin.
   */
  source: OmniOriginSource;
  sandbox: boolean;
}

export type OmniMiniAppRuntime = OmniRendererMiniAppRuntime | OmniOriginMiniAppRuntime;

export const OMNI_MINI_APP_RUNTIME: Readonly<Record<OmniMiniAppId, OmniMiniAppRuntime>> = {
  todo: { kind: 'renderer', preloadFile: 'todo.js', rendererName: 'todo', sandbox: false },
  eyesOnAgents: {
    kind: 'renderer',
    preloadFile: 'eyesOnAgents.js',
    rendererName: 'eyesOnAgents',
    sandbox: false,
  },
  translator: {
    kind: 'renderer',
    preloadFile: 'translator.js',
    rendererName: 'translator',
    sandbox: false,
  },
  motto: { kind: 'renderer', preloadFile: 'motto.js', rendererName: 'motto', sandbox: false },
  trench: { kind: 'renderer', preloadFile: 'trench.js', rendererName: 'coin', sandbox: true },
  submodules: {
    kind: 'renderer',
    preloadFile: 'submodules.js',
    rendererName: 'submodules',
    sandbox: false,
  },
  // No preload: the page is a real web app served over loopback, and handing it a privileged
  // preload would be strictly worse than the standalone window it replaces. `sandbox: true` for the
  // same reason — this is the only mini app whose content is not our own bundle.
  zellij: {
    kind: 'origin',
    source: 'zellij',
    sandbox: true,
  },
};
