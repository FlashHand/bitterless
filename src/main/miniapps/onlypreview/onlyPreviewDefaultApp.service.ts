import { app, dialog, shell } from 'electron';
import { dirname, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import { i18nHelper } from '@main/i18n/i18n.helper';

const normalizedBundlePath = (path: string): string => normalize(path).normalize('NFC').toLowerCase();

// Electron's macOS implementation resolves the full URL through Launch Services, including
// per-file associations. Do not query only "file:" (Finder) or change the default handler.
export const openOnlyPreviewInDefaultApp = async (
  target: string,
  assertCurrent: () => void
): Promise<void> => {
  if (process.platform === 'darwin') {
    let applicationPath: string;
    try {
      const application = await app.getApplicationInfoForProtocol(pathToFileURL(target).href);
      applicationPath = application.path;
      if (!applicationPath) throw new Error('No default application');
    } catch {
      throw new OnlyPreviewContractError(
        'DEFAULT_APP_UNAVAILABLE',
        'No default application is available. Choose another application in Finder.'
      );
    }
    assertCurrent();
    const ownBundle = dirname(dirname(dirname(app.getPath('exe'))));
    if (normalizedBundlePath(applicationPath) === normalizedBundlePath(ownBundle)) {
      const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
      await dialog.showMessageBox({
        type: 'info',
        message: labels.defaultAppIsSelfTitle,
        detail: labels.defaultAppIsSelfDetail,
        buttons: [labels.copyFailureOk],
        noLink: true
      });
      return;
    }
  }
  // Revalidate after the asynchronous Launch Services lookup, before any OS action.
  assertCurrent();
  const failure = await shell.openPath(target);
  if (failure) throw new Error('The operating system could not open this file.');
};
