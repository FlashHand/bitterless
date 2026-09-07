import { registerMaestroPreviewOpener } from '@maestro-main/windows/main/previewOpener.registry';
import { openRegisteredOnlyPreviewExplicitTarget } from '@main/onlypreview/onlyPreviewExplicitTarget.registry';

/**
 * Make OnlyPreview the application Cowork's workspace tools show files in.
 *
 * Registered from the host side because only this side may know both halves — Maestro offers the
 * slot, OnlyPreview fills it — and because `openRegisteredOnlyPreviewExplicitTarget` is the seam
 * that already exists for exactly this: a one-slot indirection so another subsystem can open a
 * preview target without importing the window helper. EyesOnAgents already uses it.
 *
 * The target may be a directory or a file. The explicit-open route handles both: it inspects the
 * target, authorizes it, and opens the Project rooted at the directory — selecting the file when the
 * target was one.
 */
export const registerOnlyPreviewMaestroOpener = (): void => {
  registerMaestroPreviewOpener({
    displayName: 'OnlyPreview',
    open: async (absolutePath: string) => {
      await openRegisteredOnlyPreviewExplicitTarget(absolutePath);
    }
  });
};
