/**
 * The host's preview application, as Maestro is allowed to know it.
 *
 * Maestro's workspace tools want to *show the owner some files*. Which application does that is the
 * host's business, and `check:maestro`'s alias boundary forbids Maestro from reaching for it — so
 * the host registers an opener and Maestro calls it without naming it.
 *
 * When nothing is registered the caller falls back to the OS file manager, which is what these
 * tools did before a preview application existed.
 */
export interface MaestroPreviewOpener {
  /** Open one absolute path — a directory or a file — in the host's preview application. */
  open(absolutePath: string): Promise<void>
  /** What to call it in text shown to the owner, e.g. "OnlyPreview". */
  readonly displayName: string
}
