/**
 * 树里那一下 `Cmd+C` 该不该被当成「复制这个文件」。
 *
 * **为什么这条留在渲染层。** plain `Cmd+C` 在文档里意味着「复制选中的文字」,而 main 接管一个按键
 * 的方式是 `event.preventDefault()` —— 接管就把文本复制吞掉了。判断「此刻有没有别人在占用这个键」
 * 需要看 DOM(输入框、文本选区),那是 main 看不到的东西。所以 Copy Path / Copy Name 归 main
 * (它们带修饰键,不会和文本复制冲突),plain `Cmd+C` 归这里。
 *
 * **改的是判据,不是所有权**(`docs/issues/onlypreview-copy-name-shortcut-never-matches.md` 第二条)。
 * 原来的条件是「`event.target` 正好是树行那个 `<button>`」—— 于是点了一行、焦点随后落到面板容器
 * 或面包屑上时,`Cmd+C` 什么都不做,而那一行明明还高亮着。现在问的是「有没有别人占用这个键」,
 * 没有就复制**树选中项** —— 和 main 侧那两个快捷键同一个来源,三个键从此作用在同一个东西上。
 *
 * 纯函数、不碰 DOM:`targetIsEditable` 与 `hasTextSelection` 由调用方算好传进来。这样每一条分支
 * 都能在没有浏览器的情况下被断言,而这些分支恰好都是"静默不发生"型的失败。
 */
export interface OnlyPreviewCopyShortcutEvent {
  readonly key: string;
  /** 布局/修饰键无关的物理键位。`key` 在 macOS 上会被 Option 改写(Option+C → `ç`)。 */
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly defaultPrevented: boolean;
}

export interface OnlyPreviewCopyShortcutContext {
  readonly isMac: boolean;
  /** 正在内联重命名 —— 那个输入框拥有这个键。 */
  readonly editing: boolean;
  /** 事件目标是输入框 / textarea / select / contenteditable。 */
  readonly targetIsEditable: boolean;
  /** shell 里存在非空文本选区 —— 这一下是「复制这段文字」。 */
  readonly hasTextSelection: boolean;
  /** 树选中项;`''` = 项目根;`null` = 没有选中任何东西。 */
  readonly treeSelectedRelativePath: string | null;
}

export type OnlyPreviewCopyShortcutDecision =
  | { readonly kind: 'ignore' }
  | { readonly kind: 'copy-item'; readonly relativePath: string };

const IGNORE: OnlyPreviewCopyShortcutDecision = { kind: 'ignore' };

export const resolveOnlyPreviewCopyShortcut = (
  event: OnlyPreviewCopyShortcutEvent,
  context: OnlyPreviewCopyShortcutContext
): OnlyPreviewCopyShortcutDecision => {
  if (event.defaultPrevented || event.repeat || event.isComposing) return IGNORE;
  // `code` 优先,`key` 兜底 —— 和 main 侧同一个理由(macOS 的 Option 会改写 `key`)。这里虽然只接
  // plain `Cmd+C`(下面排掉了 Shift/Alt),但两侧用同一个写法,免得下次有人只改一边。
  if (event.code !== 'KeyC' && event.key.toLowerCase() !== 'c') return IGNORE;
  const primaryModifier = context.isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  if (!primaryModifier) return IGNORE;
  // Copy Path(Shift)与 Copy Name(Alt)是 main 拥有的窗口级快捷键,不能在这里再跑一遍。
  if (event.shiftKey || event.altKey) return IGNORE;
  // 别人占用这个键的三种情形。**任何一条成立都让浏览器去做它的事** —— 这一下就是复制文字。
  if (context.editing || context.targetIsEditable || context.hasTextSelection) return IGNORE;
  const relativePath = context.treeSelectedRelativePath;
  // `''` 是合法的(项目根),所以判 `null` 而不是判真值。
  if (relativePath === null) return IGNORE;
  return { kind: 'copy-item', relativePath };
};

/** 事件目标是不是一个可编辑控件。选择器与判据分开,是为了让上面那个函数保持纯。 */
export const ONLY_PREVIEW_EDITABLE_TARGET_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="textbox"]';
