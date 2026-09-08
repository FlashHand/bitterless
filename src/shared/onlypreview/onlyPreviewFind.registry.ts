import type {
  OnlyPreviewFindCapability,
  OnlyPreviewPreviewAdapterId,
  OnlyPreviewPreviewSurface
} from './onlyPreview.types';

export type OnlyPreviewAdapterFindCapability = OnlyPreviewFindCapability | { mode: 'none' };

export interface OnlyPreviewAdapterSpec {
  surface: OnlyPreviewPreviewSurface;
  find: OnlyPreviewAdapterFindCapability;
}

export const ONLY_PREVIEW_ADAPTERS = {
  monaco: { surface: 'vue', find: { mode: 'content-adapter', adapter: 'monaco' } },
  'markdown-dom': { surface: 'vue', find: { mode: 'webcontents-find' } },
  'html-page': { surface: 'chrome', find: { mode: 'webcontents-find' } },
  'chromium-pdf': { surface: 'chrome', find: { mode: 'webcontents-find' } },
  'ooxml-xlsx': { surface: 'vue', find: { mode: 'content-adapter', adapter: 'office' } },
  'ooxml-docx': { surface: 'vue', find: { mode: 'content-adapter', adapter: 'office' } },
  'ooxml-pptx': { surface: 'vue', find: { mode: 'content-adapter', adapter: 'office' } },
  'drawio-viewer': { surface: 'vue', find: { mode: 'none' } },
  image: { surface: 'vue', find: { mode: 'none' } },
  audio: { surface: 'vue', find: { mode: 'none' } },
  video: { surface: 'vue', find: { mode: 'none' } },
  // `find: 'none'` is not a limitation to lift later — it restates what the adapter id itself
  // declares: a directory target "carries no file authority at all — no read-broker grant, no asset
  // URL, no Find coverage" (`onlyPreview.types.ts`). There is no content to search.
  //
  // `surface: 'vue'` because there is no Chromium content view for a directory: without an asset URL
  // there is nothing to navigate a WebContents to. The Vue side renders it.
  //
  // This entry was missing while `'directory'` was declared in `OnlyPreviewPreviewAdapterId` but
  // never CONSTRUCTED by anything — a declared-but-unreachable member, which is why the gap went
  // unnoticed: the only complaint was tsc's, and this repo's typecheck ran `--noCheck`
  // (`docs/issues/typecheck-is-a-false-green.md`).
  directory: { surface: 'vue', find: { mode: 'none' } },
  unsupported: { surface: 'vue', find: { mode: 'none' } }
} as const satisfies Record<OnlyPreviewPreviewAdapterId, OnlyPreviewAdapterSpec>;

export const getOnlyPreviewAdapterSpec = (
  adapterId: OnlyPreviewPreviewAdapterId
): OnlyPreviewAdapterSpec => ONLY_PREVIEW_ADAPTERS[adapterId];
