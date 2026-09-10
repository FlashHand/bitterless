/**
 * 「预览区变了」→ 通知宿主刷新地址栏。**一格间接。**
 *
 * 为什么是一格槽而不是直接调用:算出那一行要问注册表,而**把它显示到哪里**只有宿主知道 ——
 * bitterless 是 Cowork composite tab 的地址栏(独立窗口没有地址栏),micromeet-cowork 是它自己的
 * 顶栏。预览区不该知道这些,而 `check:maestro` 的别名边界也不允许它往那个方向 import。
 * 本仓已经用这个形状好几次了(`onlyPreviewExplicitTarget.registry`、`previewOpener.registry`)。
 *
 * 触发点选在 `publishPresentation()`:它是每一种"预览变了"的**汇合点**(显式打开、点树、恢复、
 * 书签、撤销后清空)。逐个调用方各推一次必然漏掉某一条,而漏掉的后果是地址栏静默停在上一个文件 ——
 * 那比不显示更糟。
 *
 * (Ral 2026-09-10:「我只是希望 url 上显示 file:// …只要看起来像真实浏览器就好」,
 * `docs/features/onlypreview-address-bar-shows-file-url.md`)
 */
type OnlyPreviewDisplayUrlSink = (hostToken: string) => void;

let sink: OnlyPreviewDisplayUrlSink | null = null;

export const registerOnlyPreviewDisplayUrlSink = (next: OnlyPreviewDisplayUrlSink): void => {
  sink = next;
};

export const clearOnlyPreviewDisplayUrlSink = (): void => {
  sink = null;
};

/**
 * 通知那一格。**吞掉异常**:地址栏是装饰性的,它出问题不该让一次预览失败 —— 而
 * `publishPresentation` 正在一条已经成功的呈现路径上。
 */
export const notifyOnlyPreviewDisplayUrl = (hostToken: string): void => {
  if (!sink) return;
  try {
    sink(hostToken);
  } catch {
    // 见上:地址栏刷新失败不该冒泡到呈现路径。
  }
};
