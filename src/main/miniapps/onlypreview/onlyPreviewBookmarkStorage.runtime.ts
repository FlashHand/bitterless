import { randomUUID } from 'node:crypto';
import { xpcMain } from 'electron-xpc/main';
import { OnlyPreviewContractError, unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import { bookmarkStorageChannel, ONLY_PREVIEW_BOOKMARK_CAPABILITY_ARG } from '@shared/onlypreview/onlyPreviewBookmarkStorage.type';
import type { OnlyPreviewBookmarkStorage, OnlyPreviewBookmarkStorageReply } from '@shared/onlypreview/onlyPreviewBookmarkStorage.type';

const capability = randomUUID();
export const onlyPreviewBookmarkStorageArgument = `${ONLY_PREVIEW_BOOKMARK_CAPABILITY_ARG}${capability}`;
export const onlyPreviewBookmarkStorage: OnlyPreviewBookmarkStorage = {
  async execute(request) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([
        xpcMain.send(bookmarkStorageChannel(capability), request) as Promise<OnlyPreviewBookmarkStorageReply>,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new OnlyPreviewContractError('OPERATION_FAILED', 'Bookmark storage did not respond. Retry the operation.')), 5000);
        })
      ]);
      return unwrapOnlyPreviewResult(reply);
    } finally {
      clearTimeout(timer);
    }
  }
};
