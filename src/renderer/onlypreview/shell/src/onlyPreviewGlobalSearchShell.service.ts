import type { OnlyPreviewGlobalSearchDirectoryRevealAction } from '@shared/onlypreview/onlyPreview.types';
import type {
  OnlyPreviewBrowseProjectionContext,
  OnlyPreviewBrowseProjectionResult,
  OnlyPreviewBrowseProjectionService
} from './onlyPreviewBrowseProjection.service';
import { onlyPreviewGlobalSearchShellClient } from './onlyPreviewGlobalSearchShell.client';
import { revealOnlyPreviewGlobalSearchDirectory } from './onlyPreviewGlobalSearchTree.service';

interface GlobalSearchDirectoryRevealOptions {
  action: OnlyPreviewGlobalSearchDirectoryRevealAction;
  workspaceId: string | null;
  generation: number | null;
  projection: OnlyPreviewBrowseProjectionService;
  browseContext: OnlyPreviewBrowseProjectionContext | null;
  expandedPaths: Set<string>;
  isCurrent?: () => boolean;
  applyResult: (result: OnlyPreviewBrowseProjectionResult) => void;
  onRevealed: (relativePath: string) => void;
}

export const handleOnlyPreviewGlobalSearchDirectoryReveal = async (
  options: GlobalSearchDirectoryRevealOptions
): Promise<void> => {
  const { action } = options;
  const contextMatches =
    options.workspaceId === action.workspaceId && options.generation === action.generation;
  const succeeded =
    contextMatches && options.browseContext
      ? await revealOnlyPreviewGlobalSearchDirectory({
          relativePath: action.relativePath,
          projection: options.projection,
          context: options.browseContext,
          expandedPaths: options.expandedPaths,
          applyResult: options.applyResult,
          isCurrent: options.isCurrent
        })
      : false;
  const accepted = succeeded && options.isCurrent?.() !== false;
  if (accepted) options.onRevealed(action.relativePath);
  await onlyPreviewGlobalSearchShellClient
    .completeDirectoryReveal(action, accepted)
    .catch(() => undefined);
};
