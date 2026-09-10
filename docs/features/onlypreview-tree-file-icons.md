# Project 树按文件类型换图标

Ral 2026-09-09：

> onlypreview__treeRow 对于不同的文件要用不同的图标了，先将常见的 docx pptx md xlsx 配置上
> 用 tabler 先，风格要统一

同日追加：**drawio 先不用支持**（那一条是关于 tab 内预览的，不影响这里的图标）。

## 落法

Ral 2026-09-09 先要「docx pptx md xlsx 用 tabler、风格统一」，随后**点名了具体这一套**：

> 默认文件图标改为：file-text 然后对应的 file-type-doc file-type-pdf file-type-xls
> file-type-zip file-type-ppt 图片类型统一用 photo-alt 都是 tabler 的

判定在 [`src/renderer/onlypreview/common/onlyPreviewTreeIcon.service.ts`](../../src/renderer/onlypreview/common/onlyPreviewTreeIcon.service.ts)，
`key → 组件` 的映射（`TREE_FILE_ICONS`）在 `shell/src/App.vue` 的 script 里。

| 扩展名 | key | tabler 图标 |
| --- | --- | --- |
| `.doc` · `.docx` | `document` | `IconFileTypeDoc` |
| `.xls` · `.xlsx` | `spreadsheet` | `IconFileTypeXls` |
| `.ppt` · `.pptx` | `presentation` | `IconFileTypePpt` |
| `.pdf` | `pdf` | `IconFileTypePdf` |
| `.zip` | `archive` | `IconFileTypeZip` |
| `.png` `.jpg` `.jpeg` `.gif` `.webp` `.bmp` `.svg` `.avif` `.ico` `.heic` `.tif` `.tiff` | `image` | `IconPhotoAlt` |
| `.md` | `markdown` | `IconMarkdown` |
| 其余 | `file` | `IconFileText` |

`.md` 他没点名，保留 `IconMarkdown`（tabler 没有 `file-type-md`）。

**返回 key 而不是组件**：这一条判定因此可以在不加载图标库的情况下被测到，而 key → 组件 的映射
留在渲染它的那个组件里一处可见，加一种类型是加一行。

**office 三种把旧扩展名一起收进来**（`.doc` / `.xls` / `.ppt`）—— 它们和新的是同一种文件，
分开处理只会让树里出现「docx 有图标、doc 没有」这种看起来像 bug 的不一致。

**压缩包只收 `.zip`。** `file-type-zip` 的纸面上写着 "ZIP"，拿它去标 `.rar` / `.7z` 是把一个错误的
三个字母贴在文件上；那几种要图标就该有自己的（tabler 现在没有）。图片相反 —— `photo-alt` 不带任何
格式字样，所以可以按他的要求**统一一个**、收全。

**只看扩展名，不嗅探内容**：树里一次可见几十行、整个项目上万个节点，为一个 14px 的图标去读文件头
不成比例。真正的格式判定在 main 侧的 `onlyPreviewClassifier.service.ts`（决定用哪个 adapter 的那一处）。

## 一条已记录的取舍：`file-type-*` 的字样在 14px 下偏小

`file-type-*` 家族的辨识信息是**画在纸面里的** "DOC"/"PDF"/"XLS" 字样，而树行图标是 **14px**，
那几个字在这个尺寸下偏小。我最初挑的是轮廓本身可辨的一组（`file-description` / `file-spreadsheet` /
`presentation`），正是为了避开这一点；**Ral 明确点名要 `file-type-*`，所以按 `file-type-*`**。

记在这里不是为了翻案，是为了让下一个人知道：这不是漏想，而且要换回轮廓那一组**只需改
`TREE_FILE_ICONS` 那张表**，判定与测试都不用动。

## 一个实测踩到的坑：注释不能插进 v-if 链

图标那一段是一条 `v-if`（展开的目录）→ `v-else-if`（收起的目录）→ `v-else-if`（符号链接）→
`v-else`（按类型的文件图标）的链。**中间插一个 HTML 注释会把链打断** —— 注释是一个节点，于是
`v-else` 那一支编译成一个注释节点，表现是「文件图标根本不出现」。

这不是推测：第一版就是把说明注释写在 `<component v-else>` 上面，`onlyPreviewTreeDensity` 那条
渲染断言直接红了（`src/file.md` 那一行的图标位置是一个 comment vnode）。注释现在放在整条链之前。

## 验证

- [`tests/onlypreview/onlyPreviewTreeIcon.test.mjs`](../../tests/onlypreview/onlyPreviewTreeIcon.test.mjs)
  —— 15 条：八种 key（office 三种 · pdf · zip · 图片 · markdown · 兜底）、旧扩展名、大小写、兜底、只取最后一段扩展名（`some.docx/inner` 与 `a.md.bak`）、
  开头的点不算扩展名（`.gitignore`）、空与 `null` 不抛，以及渲染层的接线（映射表齐全、尺寸与类一致）。
- [`tests/onlypreview/onlyPreviewTreeDensity.test.mjs`](../../tests/onlypreview/onlyPreviewTreeDensity.test.mjs)
  —— 用**真的**判定函数渲染那棵树，断言 `src/file.md` 那一行拿到 markdown 图标、目录行不走这张表。
  这一条是上面那个 v-if 链缺陷唯一的证据来源。

同步到 micromeet-cowork（`src/renderer/onlypreview/` 是逐字节等同的 vendored 面）。

## 不做

- **不给 `.rar` / `.7z` / `.tar` 用 zip 图标** —— 见上面「只收 `.zip`」的理由。
- **不给代码文件分语言图标**（tabler 有 `file-type-ts` / `-js` / `-vue` 等）。Ral 没点名，
  而代码文件在树里占比最高、分语言会让整棵树变成一片彩色标签。加一种是两行，等他要。
- **不按 main 侧的 adapter 反推图标。** 那张表在 main，树在渲染进程；为一个图标把 adapter 判定
  跨进程搬过来，代价远大于一张扩展名表。两者判错的后果也不同级（图标不对 vs 预览不了）。
