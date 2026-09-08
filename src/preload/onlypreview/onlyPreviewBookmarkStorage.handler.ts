import { xpcRenderer } from 'electron-xpc/preload';
import { onlyPreviewSuccess, toOnlyPreviewErrorPayload } from '@shared/onlypreview/onlyPreview.contract';
import { bookmarkStorageChannel, ONLY_PREVIEW_BOOKMARK_CAPABILITY_ARG } from '@shared/onlypreview/onlyPreviewBookmarkStorage.type';
import { OnlyPreviewBookmarkStorageService } from './onlyPreviewBookmarkStorage.service';

export const registerOnlyPreviewBookmarkStorage = (
  getUserDataPath: () => Promise<string>,
  readLegacy: (projectKey: string) => Promise<unknown>
): void => {
  const capability = process.argv.find((arg) => arg.startsWith(ONLY_PREVIEW_BOOKMARK_CAPABILITY_ARG))?.slice(ONLY_PREVIEW_BOOKMARK_CAPABILITY_ARG.length);
  if (!capability) throw new Error('Bookmark storage capability is missing.');
  let service: Promise<OnlyPreviewBookmarkStorageService> | null = null;
  xpcRenderer.handle(bookmarkStorageChannel(capability), async ({ params }) => {
    try {
      service ??= getUserDataPath().then((path) => new OnlyPreviewBookmarkStorageService(path, readLegacy)).catch((error) => {
        service = null;
        throw error;
      });
      return onlyPreviewSuccess(await (await service).execute(params));
    } catch (error) {
      return { ok: false, error: toOnlyPreviewErrorPayload(error) };
    }
  });
};
