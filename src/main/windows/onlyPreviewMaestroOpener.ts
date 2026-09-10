import { registerMaestroPreviewOpener } from '@maestro-main/windows/main/previewOpener.registry';
import { maestroWindowHelper } from '@maestro-main/windows/maestroWindow.helper';
import { onlyPreviewWindowHelper } from '@main/windows/onlyPreviewWindow.helper';
import {
  peekOnlyPreviewHostMount,
  readOnlyPreviewHostMount
} from '@main/miniapps/onlypreview/onlyPreviewHostMount.service';
import { openRegisteredOnlyPreviewExplicitTarget } from '@main/miniapps/onlypreview/onlyPreviewExplicitTarget.registry';

/**
 * Make OnlyPreview the application Cowork's workspace tools show files in.
 *
 * Registered from the host side because only this side may know both halves — Maestro offers the
 * slot, OnlyPreview fills it — and because `openRegisteredOnlyPreviewExplicitTarget` is the seam
 * that already exists for exactly this: a one-slot indirection so another subsystem can open a
 * preview target without importing the window helper. EyesOnAgents already uses it.
 *
 * The target may be a directory or a file. The explicit-open route handles both: it inspects the
 * target, authorizes it, and opens the Project rooted at the directory — selecting the file when the
 * target was one.
 */
export const registerOnlyPreviewMaestroOpener = (): void => {
  registerMaestroPreviewOpener({
    displayName: 'OnlyPreview',
    open: async (absolutePath: string) => {
      // **承载已经存在、只是它现在是一个窗口时,不要再建 tab。**
      //
      // OnlyPreview 被顶栏那个按钮切成独立窗口之后,那个 composite tab 就没了 —— 于是
      // `openWorkspaceInPreview` 里的 `openCompositeTab` 会**新建**一个,结果是同时存在两个
      // OnlyPreview(Ral 2026-09-09 报的就是这个)。`openRegisteredOnlyPreviewExplicitTarget`
      // 下游的 `ensureStandalone()` 本来就会返回已有 host 并把它摆到前台。
      //
      // 判断只能落在**宿主侧**:maestro 那棵树不许 import OnlyPreview(`check:maestro` 的别名边界,
      // `onlyPreviewCoworkTab.ts` 顶部说明了为什么胶水住在这里),所以 `openCompositeTabTarget`
      // 里问不了 `getStandaloneHost()`。
      // 详见 `docs/issues/onlypreview-detached-window-gets-a-second-tab.md`。
      if (onlyPreviewWindowHelper.getStandaloneHost()) {
        await openRegisteredOnlyPreviewExplicitTarget(absolutePath);
        return;
      }
      // 没有承载 → **按上次那一种开**(Ral 2026-09-09:「上次 tab 下次也 tab,上次窗口下次也窗口」)。
      //
      // 先看同步那一份:预热过就**不 await**。这条路上多插一次存储读会让芯片像卡住,
      // 所以带就绪等待的读只在启动预热里做(`hydrateOnlyPreviewHostMount`)。
      //
      // 窗口那一支不用自己建窗口:`openRegisteredOnlyPreviewExplicitTarget` 下游的
      // `ensureStandalone()` 没有 host 时就会造一个,而它造出来的窗口会从 `windowStateService` 的
      // `'onlypreview'` 键恢复上次的尺寸/位置/所在屏幕 —— 也就是他要的「复用上次的位置」。
      const mount = peekOnlyPreviewHostMount() ?? (await readOnlyPreviewHostMount());
      if (mount === 'window') {
        await openRegisteredOnlyPreviewExplicitTarget(absolutePath);
        return;
      }
      // tab 那一支:开 tab 再交目标。**那个顺序是承重的**,理由写在
      // `maestroBrowserView.openCompositeTabTarget` 上,所以这里调它而不是自己拼一遍。
      const result = await maestroWindowHelper.openWorkspaceInPreview({ path: absolutePath });
      if (!result.ok) throw new Error(result.error || 'OnlyPreview could not open that path.');
    }
  });
};
