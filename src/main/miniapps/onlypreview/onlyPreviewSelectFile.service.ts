import { xpcMain } from 'electron-xpc/main';
import {
  OnlyPreviewContractError,
  parseOnlyPreviewFileRef
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_SELECTION_CHANGED_EVENT,
  type OnlyPreviewFileRef
} from '@shared/onlypreview/onlyPreview.types';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { onlyPreviewWindowHelper } from '@main/windows/onlyPreviewWindow.helper';
import { onlyPreviewHostRegistry } from './onlyPreviewHost.registry';
import { onlyPreviewWorkspaceRegistry } from './onlyPreviewWorkspace.registry';
import { onlyPreviewSelectionCoordinator } from './onlyPreviewSelectionCoordinator.service';
import { onlyPreviewRecentDirectoryService } from './onlyPreviewRecentDirectory.service';
import { onlyPreviewTargetMutations } from './onlyPreviewExplicitOpen.service';
import { recordOnlyPreviewRecentFile } from './onlyPreviewRecents.runtime';
import { onlyPreviewPreviewRegionService } from './views/onlyPreviewPreviewRegion.service';

export const selectOnlyPreviewFile = async (
  hostToken: string,
  value: OnlyPreviewFileRef
): Promise<void> => {
  const host = onlyPreviewHostRegistry.require(hostToken, ['content']);
  const fileRef = parseOnlyPreviewFileRef(value);
  await onlyPreviewTargetMutations.run(async () => {
    onlyPreviewHostRegistry.require(host.hostToken, ['content']);
    if (
      host.kind !== 'standalone' ||
      host.hostToken !== onlyPreviewWindowHelper.getStandaloneHost()?.hostToken
    ) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'Only the active OnlyPreview host can synchronize selection.'
      );
    }
    const generation = onlyPreviewSelectionCoordinator.beginSelection(host.hostToken, fileRef);
    try {
      const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
        host.hostToken,
        fileRef
      );
      const file = await fileSearchWindowService.authorizeProjectItem({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration,
        relativePath: authority.relativePath
      });
      if (!onlyPreviewSelectionCoordinator.isCurrent(host.hostToken, generation)) return;
      if (file.nodeKind !== 'file') {
        throw new OnlyPreviewContractError(
          'PATH_NOT_REGULAR_FILE',
          'Only regular files can be selected for Preview.'
        );
      }
      onlyPreviewWorkspaceRegistry.revokeExternalPreview(host.hostToken);
      const selected = { workspaceId: file.workspaceId, relativePath: file.relativePath };
      onlyPreviewWorkspaceRegistry.select(host.hostToken, selected);
      const current = onlyPreviewPreviewRegionService.snapshot(host.hostToken);
      if (
        current.fileRef?.workspaceId !== selected.workspaceId ||
        current.fileRef.relativePath !== selected.relativePath
      ) {
        await onlyPreviewPreviewRegionService.present(host.hostToken, selected);
      }
      if (!onlyPreviewSelectionCoordinator.isCurrent(host.hostToken, generation)) return;
      const workspace = onlyPreviewWorkspaceRegistry.restore(host.hostToken);
      if (workspace?.displayPath) {
        onlyPreviewRecentDirectoryService.rememberSelectedFile(
          workspace.displayPath,
          file.relativePath
        );
      }
      await recordOnlyPreviewRecentFile(host.hostToken, file.canonicalPath);
      xpcMain.broadcast(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, { hostId: host.hostId });
    } finally {
      onlyPreviewSelectionCoordinator.finishSelection(host.hostToken, generation);
    }
  });
};
