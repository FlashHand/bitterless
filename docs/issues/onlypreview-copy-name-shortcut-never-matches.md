# `Cmd+Opt+C`（复制文件名）无效，且 `Cmd+C` 复制文件要求焦点正好在树行上

Ral 2026-09-10：

> cmd opt +c 复制文件名无效，需要优化 报错了 定位 issue 并修复 cmd+c 要有复制文件的效果，
> 例如 cmd+c 复制后 然后 cmd+v 能直接将文件粘贴到文件夹中的那种效果

两条独立的缺陷，都定位到了。

## 一、`Cmd+Opt+C` 永远匹配不上 —— macOS 上 Option+C 是 `ç`

```ts
// onlyPreviewWindow.helper.ts —— 改之前
const isProjectItemCopyShortcut = (input: Input): boolean => {
  if (
    input.type !== 'keyDown' ||
    input.isAutoRepeat ||
    input.key.toLowerCase() !== 'c' ||   // ← 这里
    …
```

macOS 把 Option 当作**组字修饰键**:按住它敲 C，`input.key` 是 `'ç'`（US 布局），不是 `'c'`。于是
这个判据直接返回 `false`，`resolveNativeCommand` 拿不到命令，`copy-project-name` 从来没有被派发过。

**为什么 `Cmd+Shift+C`（复制路径）没事**：Shift+C 产生的是 `'C'`，`.toLowerCase()` 就是 `'c'`。
这正好对上他只抱怨 Opt+C 那一个。

**这个坑本仓已经踩过两次，而且都留了正确写法**：

- `onlyPreviewWindow.helper.ts:1412` —— `(input.code === 'Digit1' || key === '1')`，就在同一个
  `resolveNativeCommand` 里，隔了两个函数。
- `src/renderer/submodules/src/App.vue:164` —— `event.code === 'KeyF' || event.key.toLowerCase() === 'f'`。

也就是说这不是一个未知问题，而是**同一个函数写的时候没有沿用已有的写法**。

**修法**：按 `code` 判，`key` 作为兼容兜底（非标准布局上 `code` 可能不是 `KeyC`）：

```ts
input.code !== 'KeyC' && input.key.toLowerCase() !== 'c'
```

顺序上先看 `code`:它与布局和修饰键都无关，是这里唯一稳定的那个信号。

**「报错了」那一半。** `copyProjectItemFromUi` 的 `catch {}` 把**任何**异常都折成同一个
「复制失败」对话框（`showCopyFailure`），所以一旦这条路上有任何东西抛出来，看到的都是那一句，
真正的原因一个字都不留。这次连带把它改成**把原因记进日志**再弹那个对话框 —— 对话框照旧（那是给人
看的），但下一次不用再靠猜。

## 二、`Cmd+C` 复制文件要求焦点正好落在树行那个 `<button>` 上

这条路**已经存在**，而且做的正是他要的事（osascript 把真文件写进剪贴板，Finder 里 `Cmd+V` 能粘贴）：

```ts
// shell/src/App.vue —— 改之前
if (
  target.matches('input, textarea, select, [contenteditable="true"], [role="textbox"]') ||
  !target.matches('button[name="onlypreview__treeRow"]')      // ← 这里
) {
  return false;
}
const relativePath = target.dataset.relativePath;
if (relativePath === undefined) return false;
```

要求 `event.target` **正好**是树行那个按钮。所以：点了一行（行被选中了）但焦点随后落到别处
（面板容器、书签栏、面包屑、点过某个图标按钮之后）时，`Cmd+C` 什么都不做 —— 行明明高亮着。

**为什么当初这么写是合理的、现在不够**:plain `Cmd+C` 在文档里意味着「复制选中的文字」，所以
main 故意不接管它（接管会 `event.preventDefault()`，那就把文本复制吞掉了）。留在渲染层是对的 ——
**只有渲染层知道此刻有没有输入框或文本选区在占用这个键**。那个判断没错，错的是它把"占用"缩小成了
"焦点正好在树行按钮上"。

**修法**：保留渲染层所有权，把判据从「焦点在哪个元素」换成「有没有别人占用这个键」：

1. 正在内联重命名（`onlyPreviewProjectAuthoring.editing`）→ 不接管。
2. 目标是可编辑控件 → 不接管（这一条原样保留）。
3. shell 里存在**非空文本选区** → 不接管：那一下就是「复制这段文字」。
4. 否则 → 复制**树选中项**（`treeSelectedRelativePath ?? selectedRelativePath`），也就是 main 侧
   Copy Path / Copy Name 用的同一个来源。三个快捷键从此作用在同一个东西上。

预览面（vue / chrome 两个 view）里 shell 这个处理器根本不挂载，所以那里的文本复制完全不受影响 ——
这也是为什么这一条**不**搬去 main:搬过去就必须在 main 里重建判断 1–3，而 main 看不到 DOM。

## 两仓

`onlyPreviewWindow.helper.ts` 是**宿主侧适配**过的文件，`shell/src/App.vue` 是**vendored 逐字节相同**
的。两处都同步落；shell 那一份改完 `diff -q` 必须无输出。

## 验证

- **A 的判据**真跑纯函数:`code === 'KeyC'` ＋ `key === 'ç'`（真实的 macOS Option+C 形态）必须匹配；
  `Cmd+Shift+C` / `Cmd+C` / `Cmd+Shift+Opt+C`（两个修饰键同时按 = 不是复制）的既有结论不变。
- **B 的判据**真跑纯函数（提取成可测的谓词）:编辑中、可编辑目标、有文本选区三种都不接管；
  树有选中项且以上都不成立时接管。
- **变异测试**:`code` 判据去掉（回到缺陷）· `code`/`key` 次序不影响结果 · 三条不接管的条件各删一条 ·
  复制源改回 `target.dataset.relativePath`（回到"焦点必须在按钮上"）。
- **运行时那一半要你跑一次**:选中一行 → 点一下别处（比如面包屑）→ `Cmd+C` → 去 Finder `Cmd+V`,
  文件应该被粘贴进去；再试 `Cmd+Opt+C`，剪贴板里应该是**文件名**；重命名输入框里选中几个字符按
  `Cmd+C`，应该复制的是那几个字符而不是文件。
