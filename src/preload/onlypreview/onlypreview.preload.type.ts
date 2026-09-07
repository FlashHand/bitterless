export type OnlyPreviewEntryMode =
  | 'shell'
  | 'preview'
  | 'globalSearch'
  | 'alert'
  | 'settings'
  | 'guide';
export type OnlyPreviewHostPlatform = 'darwin' | 'win32' | 'other';
/**
 * Which kind of host carries this composite.
 *
 * Named `host` rather than `mount` deliberately: `mode` already means the renderer entry
 * (shell/preview/...), and `mode` vs `mount` differ by one letter in a file where both would appear
 * on adjacent lines. It is the mount's `kind` on the Main side.
 */
export type OnlyPreviewHostSurface = 'window' | 'cowork';

export interface OnlyPreviewEnvApi {
  readonly hostToken: string | null;
  readonly hostId: string | null;
  readonly previewRuntimeToken: string | null;
  readonly openTag: string | null;
  readonly mode: OnlyPreviewEntryMode;
  readonly platform: OnlyPreviewHostPlatform;
  /**
   * The host this surface is mounted on. Drives which window controls the Shell renders: a Cowork
   * tab has no traffic lights and no window of its own to minimize, so offering those buttons would
   * put controls on screen whose only possible behaviour is to do nothing.
   */
  readonly host: OnlyPreviewHostSurface;
}
