/**
 * 地址栏里的一条**本机绝对路径**该落到哪(Ral 2026-09-09,`docs/features/address-bar-local-path.md`)。
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
import { isAbsoluteFilePath } from '@shared/onlypreview/onlyPreviewTargetInput'
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
   *
   * `fileUrl` 为空串 = 这一串根本不是绝对路径(调用方没先判)。调用方既有的 `if (!target) return`
   * 会把它吞掉 —— 不猜、不拿当前工作目录兜底。
   */
  | { kind: 'missing'; fileUrl: string }

export const resolveLocalPathTarget = (
  input: string,
  exists: (path: string) => boolean = existsSync
): LocalPathTarget => {
  const raw = (input || '').trim()
  // 不是绝对路径就地返回。**不能落到下面的 `resolve`** —— `resolve('')` 是当前工作目录,
  // 而当前工作目录一定存在,于是「空输入」会变成「预览 cwd」:一个静默且莫名的结果。
  if (!isAbsoluteFilePath(raw)) return { kind: 'missing', fileUrl: '' }
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
