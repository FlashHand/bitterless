import type { OnlyPreviewApi } from '@shared/onlypreview/onlyPreview.types';

export type OnlyPreviewRecentsClient = Pick<
  OnlyPreviewApi,
  'getRecents' | 'openRecent' | 'navigateRecent' | 'reloadPreview'
>;

export interface OnlyPreviewRecentsIdentity {
  hostId: string | null;
  hostToken: string | null;
}
