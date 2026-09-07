import type { MaestroPreviewOpener } from '@maestro-shared/previewOpener.api'

/**
 * The host's preview application, if this build has one.
 *
 * Null until a host registers, which is the point: nothing here imports a preview application, so
 * the alias boundary stays intact and a Maestro build without one still works.
 */
let opener: MaestroPreviewOpener | null = null

export const registerMaestroPreviewOpener = (next: MaestroPreviewOpener): void => {
  opener = next
}

export const getMaestroPreviewOpener = (): MaestroPreviewOpener | null => opener
