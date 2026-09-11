/**
 * Which Zellij session a terminal surface attaches to.
 *
 * `zellij web` has no session flag — it serves every session on the machine, and the WEB CLIENT
 * picks one from the URL path (`/` and `/<name>` return byte-identical HTML; the choice happens in
 * its JavaScript). Loading the bare origin is what made the terminal ask for a name on every open.
 *
 * The name is per SURFACE, not per runtime profile (Ral 2026-09-11:「我期望 zellij 可以存在于多个
 * tab,init and open 应该打开新的 session」). Keying on the profile meant every surface resolved to
 * the same `bitterless` session, so a second terminal silently drove the first one's panes and
 * "Initialize and open" reattached to the previous session instead of starting a fresh one.
 *
 * The profile still participates, as a PREFIX rather than the whole name: Production and Preview can
 * run side by side, and their sessions must stay visually distinguishable in `zellij list-sessions`.
 */
import type { ApplicationRuntimeProfileId } from '@shared/diagnostics/applicationDiagnostics.contract';

const PROFILE_SESSION_SUFFIX: Record<ApplicationRuntimeProfileId, string> = {
  production: '',
  'production-preview': '-preview',
  'production-debug': '-debug',
  'test-debug': '-test-debug',
  'test-release': '-test'
};

export const ZELLIJ_SESSION_BASE_NAME = 'bitterless';

/** Longest session name we will produce. Zellij shows these in its own UI; keep them readable. */
export const ZELLIJ_SESSION_MAX_LENGTH = 48;

/** The per-profile prefix every surface of this build shares. */
export const zellijSessionPrefix = (profile: ApplicationRuntimeProfileId): string =>
  `${ZELLIJ_SESSION_BASE_NAME}${PROFILE_SESSION_SUFFIX[profile]}`;

/**
 * A surface id is ours, but it reaches Zellij's CLI (`zellij attach <name>`) and a URL path, so
 * reduce it to characters that are unambiguous in both rather than trusting its current shape.
 */
export const resolveZellijSessionName = (
  profile: ApplicationRuntimeProfileId,
  surfaceId: string
): string => {
  const slug = surfaceId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // An id that sanitises away entirely would collapse every such surface onto one session; refusing
  // is better than silently sharing panes between terminals.
  if (!slug) {
    throw new Error(`[zellij] surface id has no usable characters: ${JSON.stringify(surfaceId)}`);
  }
  return `${zellijSessionPrefix(profile)}-${slug}`.slice(0, ZELLIJ_SESSION_MAX_LENGTH);
};

/**
 * `encodeURIComponent`, not raw concatenation: the name is sanitised above, but a future caller that
 * skips that must fail loudly rather than address a different route.
 */
export const zellijSessionUrl = (origin: string, session: string): string =>
  `${origin}/${encodeURIComponent(session)}`;
