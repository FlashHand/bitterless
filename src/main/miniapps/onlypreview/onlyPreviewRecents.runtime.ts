import { xpcMain } from 'electron-xpc/main';
import { ONLY_PREVIEW_RECENTS_CHANGED_EVENT } from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewHostRegistry } from './onlyPreviewHost.registry';
import { onlyPreviewWorkspaceRegistry } from './onlyPreviewWorkspace.registry';
import { onlyPreviewPreviewRegionService } from './views/onlyPreviewPreviewRegion.service';
import { OnlyPreviewRecentsService } from './onlyPreviewRecents.service';

export const onlyPreviewRecentsService = new OnlyPreviewRecentsService(
  onlyPreviewHostRegistry,
  onlyPreviewWorkspaceRegistry,
  (hostToken) => onlyPreviewPreviewRegionService.snapshot(hostToken),
  (hostId) => xpcMain.broadcast(ONLY_PREVIEW_RECENTS_CHANGED_EVENT, { hostId })
);

export const recordOnlyPreviewRecentFile = async (
  hostToken: string,
  path: string
): Promise<void> => {
  try {
    await onlyPreviewRecentsService.record(hostToken, path);
  } catch {
    // Optional history persistence must not turn an accepted file open into a failure.
    console.warn('[OnlyPreview] Recent file history could not be saved.');
  }
};
