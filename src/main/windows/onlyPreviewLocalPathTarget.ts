/**
 * 地址栏里的一条**本机绝对路径**该落到哪(Ral 2026-09-09,`docs/features/address-bar-local-path.md`)。
 *
 * **住在宿主侧,不在 maestro 里。** 它要问两件只有宿主知道的事:什么算绝对路径、哪些格式普通 tab
 * 自己渲染得了。曾经有一版住在 `main/maestro/windows/main/` 并直接 import
 * `@shared/onlypreview/*` 与 `@main/miniapps/onlypreview/*` —— `check:maestro` 的别名边界拦下了它,
 * 而且那不只是一条断言:那些 import 把宿主整棵 onlypreview 子树(连 fileSearch / menu)拖进了
 * maestro 的测试打包里,`maestroCompositeTabNavigation` 直接在 esbuild 阶段挂掉。
 * 现在 maestro 通过 `MaestroPreviewOpener.resolveLocalTarget` 端口问同一个问题。
 *
 * 判据本身在 `@shared/onlypreview/onlyPreviewTargetInput` —— 那一面两仓逐字节等同,所以两个 app
 * 的地址栏问的是**同一个**问题。这一份只回答第二个问题:**这个文件在不在**,以及不在时给哪个
 * `file://`。两件事分开,是因为判据必须是纯函数(渲染层也 import 那一面),而"在不在"必须碰文件系统。
 *
 * `exists` 可注入 —— 这条判定的两个分支都有可见后果,所以它必须能在没有真实文件的情况下被测到。
 */
import { existsSync } from 'fs'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
import { resolveAddressBarLocalPath } from '@shared/onlypreview/onlyPreviewTargetInput'
import { rendersInPlainWebContents } from '@main/miniapps/onlypreview/onlyPreviewClassifier.service'

export type LocalPathTarget =
  /**
   * 在,而且一个普通 tab 的 WebContents 自己就能渲染好(pdf / 图片 / 音视频 / html)——
   * **就在这个 tab 里加载它**,不进 OnlyPreview(Ral 2026-09-09:「不会进入 onlypreview 的预览,
   * 而是 new tab 打开一个页面去单独预览」)。判据在 `rendersInPlainWebContents`。
   */
  | { kind: 'chrome'; fileUrl: string; path: string }
  /**
   * 在,但需要预览组件才看得了(docx / xlsx / pptx / drawio / markdown / 代码 / 目录)。
   *
   * **暂时**仍交给 OnlyPreview —— tab 内的独立预览页(把 VuePreview 那组组件拷一份出来)是下一步,
   * 见 `docs/features/address-bar-local-path.md` 的「还差什么」。
   */
  | { kind: 'preview'; path: string }
  /**
   * 不在 —— 落一个 `file://`,让 **Chromium 出它自己的「文件不存在」页**。
   *
   * 这就是 Ral 说的「和网页共用不存在的组件」:不新建一个自己的空状态组件,新建一个就等于同一件
   * 事有两种长相,而且它还得把 Chromium 已经做好的本地化与「重新加载」再做一遍。
   */
  | { kind: 'missing'; fileUrl: string }

export const resolveLocalPathTarget = (
  input: string,
  exists: (path: string) => boolean = existsSync
): LocalPathTarget | null => {
  // 不是本机路径 → `null`(「不是我的」)。**不能落到下面的 `resolve`** —— `resolve('')` 是当前
  // 工作目录,而当前工作目录一定存在,于是「空输入」会变成「预览 cwd」:一个静默且莫名的结果。
  //
  // 早先这里返回的是 `{ kind: 'missing', fileUrl: '' }`,靠调用方的 `if (!target) return` 兜住。
  // 换成 `null` 是因为端口需要一个明确的「不是本机路径」答案 —— 空串哨兵在跨边界时读不出这个意思。
  //
  // 判据用 `resolveAddressBarLocalPath` 而不是 `isAbsoluteFilePath`:地址栏现在**显示**
  // `file://…`(Ral 2026-09-10),而地址栏是可编辑的 —— 对着显示出来的那一行按回车必须回到同一个
  // 文件。只认裸路径的话那次回车会落到调用方的 `normalizeUrl`,Chromium 在普通 tab 里直接加载它,
  // 一个 `.csv` 变成原始文本。见 `docs/features/onlypreview-address-bar-shows-file-url.md`。
  const raw = resolveAddressBarLocalPath(input)
  if (raw === null) return null
  // `resolve` 在这里只做归一(去掉 `..`、`.`、重复斜杠),POSIX 绝对路径进出不变。
  //
  // 一条 Windows 路径贴到 mac 上会被 `resolve` 当相对路径接到 cwd 后面 —— 那串东西一定不存在,
  // 所以落 `missing`,这正是要的结果(「这个文件不存在」),只是错误页上显示的路径会带上 cwd 前缀。
  // 不为这一种情形单开分支:代价是一行显示文本,收益是这里只有一条路径。
  const target = resolve(raw)
  if (!exists(target)) return { kind: 'missing', fileUrl: pathToFileURL(target).href }
  // `rendersInPlainWebContents` 只看扩展名,所以**目录**也会被它判成 false —— 那正是要的:
  // 目录得由预览面的 `directory` adapter 呈现,普通 WebContents 只会给一个文件列表。
  if (rendersInPlainWebContents(target)) {
    return { kind: 'chrome', fileUrl: pathToFileURL(target).href, path: target }
  }
  return { kind: 'preview', path: target }
}
