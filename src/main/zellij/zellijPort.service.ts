import type { ApplicationRuntimeProfileId } from '@shared/diagnostics/applicationDiagnostics.contract';

/**
 * Which port this build's Zellij web server listens on.
 *
 * Two independent reasons this cannot be one constant:
 *
 *  1. **Per app.** Bitterless and cowork each run their OWN server. Bitterless owns the 12877 block,
 *     cowork owns 12888.
 *  2. **Per environment of the SAME app.** Production, Preview and the debug builds can run side by
 *     side (each already gets its own `userData` via the runtime profile). With one port the second
 *     one to start hits `port-occupied` and its terminal never works — and worse, the probe would
 *     find a *foreign* profile's server on that port, accept it as version-matching, and attach to
 *     it, so Preview would be driving Production's shells.
 *
 * Offsets are explicit rather than computed from an index, so reordering
 * `APPLICATION_RUNTIME_PROFILE_IDS` cannot silently move a running install's port.
 */
export const ZELLIJ_BASE_PORT = 12877;

const PROFILE_PORT_OFFSET: Record<ApplicationRuntimeProfileId, number> = {
  production: 0,
  'production-preview': 1,
  'production-debug': 2,
  'test-debug': 3,
  'test-release': 4
};

/** Highest offset above, i.e. the block Bitterless reserves: 12877–12881. cowork starts at 12888. */
export const ZELLIJ_PORT_BLOCK_SIZE = 5;

export const ZELLIJ_PORT_ENV_VAR = 'BITTERLESS_ZELLIJ_PORT';

const isUsablePort = (value: number): boolean =>
  Number.isInteger(value) && value >= 1024 && value <= 65535;

/**
 * An override that is present but unusable is a configuration mistake, not a reason to silently run
 * somewhere else — falling back would start a server the operator cannot find.
 */
export const parseZellijPortOverride = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!isUsablePort(parsed)) {
    throw new Error(
      `${ZELLIJ_PORT_ENV_VAR} must be an integer port between 1024 and 65535, got ${JSON.stringify(raw)}`
    );
  }
  return parsed;
};

export const resolveZellijPort = (
  profile: ApplicationRuntimeProfileId,
  env: NodeJS.ProcessEnv = process.env
): number =>
  parseZellijPortOverride(env[ZELLIJ_PORT_ENV_VAR]) ??
  ZELLIJ_BASE_PORT + PROFILE_PORT_OFFSET[profile];

export const zellijOriginForPort = (port: number): string => `http://127.0.0.1:${port}`;
