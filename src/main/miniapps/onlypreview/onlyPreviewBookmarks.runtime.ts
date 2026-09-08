import { xpcMain } from 'electron-xpc/main';
import { ONLY_PREVIEW_BOOKMARKS_CHANGED_EVENT } from '@shared/onlypreview/onlyPreviewBookmarks.type';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { onlyPreviewWorkspaceRegistry } from './onlyPreviewWorkspace.registry';
import { OnlyPreviewBookmarksService } from './onlyPreviewBookmarks.service';

export const onlyPreviewBookmarksService = new OnlyPreviewBookmarksService(
  onlyPreviewWorkspaceRegistry,
  (authority) =>
    fileSearchWindowService.authorizeProjectItem({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration,
      relativePath: authority.relativePath
    }),
  (hostId, workspaceId) =>
    xpcMain.broadcast(ONLY_PREVIEW_BOOKMARKS_CHANGED_EVENT, { hostId, workspaceId })
);
