import { isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';

export const resolveOnlyPreviewMarkdownLink = (
  sourcePath: string,
  href: unknown
): { path: string; fragment?: string } => {
  try {
    if (
      !isAbsolute(sourcePath) ||
      typeof href !== 'string' ||
      !href ||
      href.length > 8192 ||
      /\p{Cc}/u.test(href) ||
      /\p{Cc}/u.test(decodeURIComponent(href))
    ) {
      throw new Error('Invalid local link.');
    }
    const url = new URL(href, pathToFileURL(sourcePath));
    if (
      url.protocol !== 'file:' ||
      (url.hostname && url.hostname !== 'localhost') ||
      url.username ||
      url.password
    )
      throw new Error('Non-local link.');
    const path = fileURLToPath(url);
    if (!isAbsolute(path) || /\p{Cc}/u.test(path)) throw new Error('Invalid local path.');
    const fragment = url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined;
    return { path, ...(fragment ? { fragment } : {}) };
  } catch {
    throw new OnlyPreviewContractError(
      'INVALID_INPUT',
      'Only local file links can be opened from Markdown.'
    );
  }
};
