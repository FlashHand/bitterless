/**
 * Project 树里一行该用哪个文件图标。
 *
 * Ral 2026-09-09 先要「docx pptx md xlsx 用 tabler,风格统一」,随后点名了具体这一套:
 * 「默认文件图标改为 file-text,然后对应的 file-type-doc / file-type-pdf / file-type-xls /
 * file-type-zip / file-type-ppt,图片类型统一用 photo-alt」。所以现在用的是 tabler 的
 * **`file-type-*` 家族**(纸面里写着 DOC/PDF/XLS 字样的那一套),这是他的选择 —— 我原先挑的是
 * 轮廓可辨的一组,理由是 14px 下纸面里的字读不出来;他要 `file-type-*`,就按 `file-type-*`。
 *
 * **返回的是一个 key,不是组件。** 两个理由:这一条判定因此可以在不加载图标库的情况下被测到;
 * 而 key → 组件 的映射留在渲染它的那个组件里,一处可见,加一种类型是加一行。
 *
 * **只看扩展名,不嗅探内容。** 树里一次可见几十行、整个项目上万个节点,为了一个 14px 的图标去读
 * 文件头是不成比例的。判错的代价也只是图标不对,不影响预览 —— 真正的格式判定在
 * `onlyPreviewClassifier.service.ts`(main 侧,它才是决定用哪个 adapter 的那一处)。
 */

/** 树行图标的取值。`file` 是兜底,现在落 `file-text`(Ral 2026-09-09)。 */
export type OnlyPreviewFileIconKey =
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'markdown'
  | 'pdf'
  | 'archive'
  | 'image'
  | 'file';

/**
 * 扩展名 → key。
 *
 * office 三种都把**旧扩展名一起收进来**(`.doc` / `.xls` / `.ppt`)—— 那不是多做:它们和新的是同一种
 * 文件,分开处理只会让树里出现"docx 有图标、doc 没有"这种看起来像 bug 的不一致。
 *
 * **压缩包只收 `.zip`。** `file-type-zip` 的纸面上写着 "ZIP",拿它去标 `.rar` / `.7z` 是把一个
 * 错误的三个字母贴在文件上;那几种要图标就该有自己的(tabler 现在没有)。
 *
 * 图片按 Ral 的要求**统一一个** `photo-alt`,所以这里可以收全 —— 它不带任何格式字样,
 * 不存在标错的问题。
 */
const ICON_BY_EXTENSION: Readonly<Record<string, OnlyPreviewFileIconKey>> = {
  '.doc': 'document',
  '.docx': 'document',
  '.xls': 'spreadsheet',
  '.xlsx': 'spreadsheet',
  '.ppt': 'presentation',
  '.pptx': 'presentation',
  '.md': 'markdown',
  '.pdf': 'pdf',
  '.zip': 'archive',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.svg': 'image',
  '.avif': 'image',
  '.ico': 'image',
  '.heic': 'image',
  '.tif': 'image',
  '.tiff': 'image'
};

const extensionOf = (relativePath: string): string => {
  const name = (relativePath || '').split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  // `dot <= 0` 同时排掉「没有点」和「点在开头」(`.gitignore` 不是 `gitignore` 类型的文件)。
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
};

export const resolveOnlyPreviewFileIconKey = (relativePath: string): OnlyPreviewFileIconKey =>
  ICON_BY_EXTENSION[extensionOf(relativePath)] ?? 'file';
