import type { OnlyPreviewApi } from '@shared/onlypreview/onlyPreview.types';
export type OnlyPreviewBookmarksClient = Pick<
  OnlyPreviewApi,
  'getBookmarks' | 'addBookmark' | 'showBookmarkContextMenu'
>;
export interface OnlyPreviewBookmarksHost {
  hostToken: string | null;
  hostId: string | null;
  workspaceId: () => string | null;
}
