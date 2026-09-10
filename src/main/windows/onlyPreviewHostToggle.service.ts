import { resolve } from 'node:path';
import type { BaseWindow } from 'electron';
import { xpcMain } from 'electron-xpc/main';
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller';
import { getMaestroCompositeTab } from '@maestro-main/windows/main/compositeTab.registry';
import {
  OnlyPreviewContractError,
  toOnlyPreviewErrorPayload
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_HOST_TOGGLE_CHANGED_EVENT,
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT,
  type OnlyPreviewErrorPayload,
  type OnlyPreviewHostToggleState
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewWindowHelper } from './onlyPreviewWindow.helper';
import { ONLY_PREVIEW_COWORK_TAB_ID } from './onlyPreviewCoworkTab';
import type { OnlyPreviewMountKind } from '@main/miniapps/onlypreview/onlyPreviewSurface.mount';
import type { OnlyPreviewHostCapability } from '@main/miniapps/onlypreview/onlyPreviewHost.registry';
import { onlyPreviewWorkspaceRegistry } from '@main/miniapps/onlypreview/onlyPreviewWorkspace.registry';
import { onlyPreviewRecentDirectoryService } from '@main/miniapps/onlypreview/onlyPreviewRecentDirectory.service';
import { rememberOnlyPreviewHostMount } from '@main/miniapps/onlypreview/onlyPreviewHostMount.service';
import { onlyPreviewPreviewRegionService } from '@main/miniapps/onlypreview/views/onlyPreviewPreviewRegion.service';
import {
  onlyPreviewTargetMutations,
  presentOnlyPreviewExplicitFile
} from '@main/miniapps/onlypreview/onlyPreviewExplicitOpen.service';
import { onlyPreviewLogService } from '@main/miniapps/onlypreview/onlyPreviewLog.runtime';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';

// Only native targets survive this one transition. All workspace/file capabilities are reissued.
interface TransitionTarget {
  directoryPath: string | null;
  filePath: string | null;
}

class OnlyPreviewHostToggleService {
  private pending: { hostToken: string; promise: Promise<void> } | null = null;
  private failure: { hostToken: string; error: OnlyPreviewErrorPayload } | null = null;

  getState(hostToken: string): OnlyPreviewHostToggleState {
    onlyPreviewWindowHelper.getMountKind(hostToken);
    return {
      canDock: Boolean(this.dockWindow()),
      pending: this.pending !== null,
      ...(this.failure?.hostToken === hostToken ? { error: this.failure.error } : {})
    };
  }

  toggle(hostToken: string): Promise<void> {
    onlyPreviewWindowHelper.getMountKind(hostToken);
    if (this.pending) {
      // COALESCE, do not refuse — for ANY host token (Ral 2026-09-07: repeated clicking must
      // settle). Refusing a different token was wrong in the one case that actually happens:
      // a transition REPLACES the host, so the shell that fires the second click is a different
      // shell holding a different token, and the old guard turned "clicked twice" into a thrown
      // contract error the user saw as a failure banner.
      //
      // Joining is safe because there is at most one live composite: two requests to move it are
      // the same request. What must NOT happen is a second `relocate` starting while the first is
      // mid-flight — that tears down the host the first one is still building into, which surfaces
      // as an aborted load and lands the composite back where it started.
      return this.pending.promise;
    }
    this.failure = null;
    const promise = onlyPreviewTargetMutations.run(async () => {
      try {
        await this.relocate(hostToken);
      } catch (error) {
        this.recordFailure(error);
        throw error;
      } finally {
        this.pending = null;
        this.broadcastState();
      }
    });
    this.pending = { hostToken, promise };
    this.broadcastState();
    return promise;
  }

  private dockWindow(): BaseWindow | null {
    const window = maestroWindowHelper.browserWindow;
    return window && !window.isDestroyed() && getMaestroCompositeTab(ONLY_PREVIEW_COWORK_TAB_ID)
      ? window
      : null;
  }

  private requireDockWindow(expected: BaseWindow | null): void {
    if (!expected || this.dockWindow() !== expected) {
      throw new OnlyPreviewContractError(
        'HOST_NOT_FOUND',
        'The Cowork browser window is not available.'
      );
    }
  }

  private captureTarget(hostToken: string): TransitionTarget {
    const workspace = onlyPreviewWorkspaceRegistry.restore(hostToken);
    const fileRef = onlyPreviewPreviewRegionService.snapshot(hostToken).fileRef;
    let filePath: string | null = null;
    if (fileRef) {
      const external = onlyPreviewWorkspaceRegistry.getExternalPreviewNativePath(
        hostToken,
        fileRef
      );
      if (external) filePath = external;
      else {
        const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
          hostToken,
          fileRef
        );
        const record = onlyPreviewWorkspaceRegistry.requireWorkspace(
          hostToken,
          authority.workspaceId
        );
        filePath = resolve(record.rootRealPath, authority.relativePath);
      }
    }
    return { directoryPath: workspace?.displayPath ?? null, filePath };
  }

  /**
   * Close the current carrier and wait for it, so nothing from the old host outlives this call.
   *
   * For a tab that means awaiting the tab close — closing the tab is what runs the composite's own
   * teardown (`mount.reportHostGone()` → `destroyStandalone()`), so this both closes the carrier and
   * stops the renderers and the file-search runtime behind it. The trailing `destroyStandalone()` is
   * then normally a no-op and is kept only for the standalone case and as a backstop.
   */
  private async teardownSource(sourceKind: OnlyPreviewMountKind): Promise<void> {
    if (sourceKind === 'cowork') {
      const tabs = await maestroWindowHelper.getTabs();
      for (const tab of tabs.filter((tab) => tab.kind === ONLY_PREVIEW_COWORK_TAB_ID)) {
        await maestroWindowHelper.closeTab({ id: tab.id });
      }
    }
    onlyPreviewWindowHelper.destroyStandalone();
    console.info(
      `[onlypreview] event=host-toggle phase=torn-down source=${sourceKind}` +
        ` liveHost=${onlyPreviewWindowHelper.getStandaloneHost() ? 'yes' : 'null'}`
    );
  }

  private async buildHost(
    kind: OnlyPreviewMountKind,
    dockWindow: BaseWindow | null
  ): Promise<OnlyPreviewHostCapability> {
    if (kind === 'standalone') {
      const host = await onlyPreviewWindowHelper.ensureStandalone();
      if (onlyPreviewWindowHelper.getMountKind(host.hostToken) !== kind) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'OnlyPreview could not be opened in a separate window.'
        );
      }
      return host;
    }
    this.requireDockWindow(dockWindow);
    // A previously requested tab may be an empty placeholder while standalone owned the surface.
    // This explicit move may replace that one tab, never any unrelated tab or the browser window.
    const tabs = await maestroWindowHelper.getTabs();
    this.requireDockWindow(dockWindow);
    if (onlyPreviewWindowHelper.getStandaloneHost()) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'OnlyPreview already has a live host.'
      );
    }
    for (const tab of tabs.filter((tab) => tab.kind === ONLY_PREVIEW_COWORK_TAB_ID)) {
      await maestroWindowHelper.closeTab({ id: tab.id });
      this.requireDockWindow(dockWindow);
    }
    await maestroWindowHelper.openCompositeTab({ id: ONLY_PREVIEW_COWORK_TAB_ID });
    this.requireDockWindow(dockWindow);
    const host = onlyPreviewWindowHelper.getStandaloneHost();
    if (!host || onlyPreviewWindowHelper.getMountKind(host.hostToken) !== 'cowork') {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'OnlyPreview could not be opened in a Cowork tab.'
      );
    }
    return host;
  }

  private async restoreTarget(
    host: OnlyPreviewHostCapability,
    target: TransitionTarget,
    generation: number
  ): Promise<void> {
    onlyPreviewRecentDirectoryService.bindExplicitTarget(host.hostToken, generation);
    try {
      if (target.directoryPath) {
        const workspace = await onlyPreviewRecentDirectoryService.openExplicitTarget(
          host.hostToken,
          target.directoryPath,
          generation
        );
        if (!workspace)
          throw new OnlyPreviewContractError(
            'WORKSPACE_NOT_FOUND',
            'The Project could not be restored.'
          );
      }
      if (target.filePath) {
        const inspected = await fileSearchWindowService.inspectTarget(target.filePath);
        onlyPreviewWindowHelper.getMountKind(host.hostToken);
        await presentOnlyPreviewExplicitFile(host, inspected);
      }
    } catch (error) {
      // A deleted/changed file must not undo a successful move or leave an old document on screen.
      // The fresh host keeps its restored Project and exposes the failure independently of sender.
      this.recordFailure(error);
    } finally {
      xpcMain.broadcast(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT, { hostId: host.hostId });
    }
  }

  private async relocate(hostToken: string): Promise<void> {
    const sourceKind = onlyPreviewWindowHelper.getMountKind(hostToken);
    const sourceWindow = onlyPreviewWindowHelper.getStandaloneWindow(hostToken);
    const destinationKind = sourceKind === 'cowork' ? 'standalone' : 'cowork';
    const dockWindow = this.dockWindow();
    // Decision trace. Without it this transition's failure mode is unreadable: the `catch` below
    // rebuilds on `sourceKind`, so a failed move looks exactly like "the button did nothing" — or,
    // when the destination did get built first, like "it opened and then went back". The observed
    // report (`open in window` ending up as a reload in the tab) is that second shape, and the log
    // only showed the ERR_FAILED of an aborted load, never which side asked for what.
    console.info(
      `[onlypreview] event=host-toggle phase=plan source=${sourceKind}` +
        ` destination=${destinationKind} dock=${dockWindow ? 'yes' : 'null'}` +
        ` sourceWindow=${sourceWindow ? 'yes' : 'null'}`
    );
    if (destinationKind === 'cowork') {
      this.requireDockWindow(dockWindow);
      await maestroWindowHelper.whenReady();
      this.requireDockWindow(dockWindow);
    }
    await onlyPreviewRecentDirectoryService.flushPendingWrites();
    onlyPreviewWindowHelper.getMountKind(hostToken);
    if (destinationKind === 'cowork') this.requireDockWindow(dockWindow);
    const target = this.captureTarget(hostToken);
    const generation = onlyPreviewRecentDirectoryService.beginExplicitTarget();
    // Keep the search runtime alive across this transition: the index build in flight inside it
    // must not restart, and a runtime that is not being torn down cannot tear down its successor.
    onlyPreviewWindowHelper.beginHostTransition();
    try {
      // Tear the SOURCE host down COMPLETELY, and wait for it, before building anything
      // (Ral 2026-09-07: 「先关闭 tab 和对应的渲染进程,再触发新的 window 打开 preview」).
      //
      // This is the fix for a whole class of failure rather than one instance of it. The previous
      // order was `destroyStandalone()` then immediately `buildHost(...)`, and `destroyStandalone`
      // closes a Cowork tab through `mount.destroyHost()` — which is FIRE-AND-FORGET on the tab
      // side. So the old tab's renderers and its file-search runtime were still shutting down while
      // the new host was already starting, and a late message from the dying side would tear down
      // the runtime the new side had just built. Measured: `start()` created the new file-search
      // window, and 14ms later `rejectOfficeReadProtocol` destroyed it mid-load, which surfaced as
      // `ERR_FAILED (-2)` on a page that serves HTTP 200
      // (docs/issues/onlypreview-host-toggle-tears-down-the-new-runtime.md).
      //
      // Awaiting the carrier close first means there is nothing left alive to send that message.
      await this.teardownSource(sourceKind);
      let host: OnlyPreviewHostCapability;
      try {
        host = await this.buildHost(destinationKind, dockWindow);
      } catch (error) {
        // THIS is what turns a failed move into "it went back where it was" on screen.
        console.info(
          `[onlypreview] event=host-toggle phase=failed destination=${destinationKind}` +
            ` recoverTo=${sourceKind} error=${(error as Error)?.message ?? String(error)}`
        );
        onlyPreviewWindowHelper.destroyStandalone();
        try {
          const recovered = await this.buildHost(
            sourceKind,
            sourceKind === 'cowork' ? sourceWindow : null
          );
          await this.restoreTarget(recovered, target, generation);
          console.info(`[onlypreview] event=host-toggle phase=recovered kind=${sourceKind}`);
        } catch (recoveryError) {
          console.info(
            `[onlypreview] event=host-toggle phase=recovery-failed` +
              ` error=${(recoveryError as Error)?.message ?? String(recoveryError)}`
          );
          this.recordFailure(recoveryError);
        }
        throw error;
      }
      await this.restoreTarget(host, target, generation);
      const settledKind = onlyPreviewWindowHelper.getMountKind(host.hostToken);
      console.info(
        `[onlypreview] event=host-toggle phase=settled destination=${destinationKind}` +
          ` actual=${settledKind}`
      );
      // 记下**结算之后的**那一种,而不是 `destinationKind` —— 切换可能落在别处(`buildHost` 失败后
      // 的回退),而"下次开哪种"要跟着实际结果,不是跟着意图。
      // 不 await:一次写不进去只该影响下次的默认,不该把一次成功的切换报成失败。
      rememberOnlyPreviewHostMount(settledKind === 'standalone' ? 'window' : 'tab');
      onlyPreviewWindowHelper.show();
    } finally {
      onlyPreviewWindowHelper.endHostTransition();
      onlyPreviewRecentDirectoryService.finishExplicitTarget(generation);
    }
  }

  private recordFailure(error: unknown): void {
    const payload = toOnlyPreviewErrorPayload(error);
    const host = onlyPreviewWindowHelper.getStandaloneHost();
    if (host) this.failure = { hostToken: host.hostToken, error: payload };
    onlyPreviewLogService.writeOperationFailure({
      operation: 'toggleHost',
      code: payload.code,
      error
    });
  }

  private broadcastState(): void {
    const host = onlyPreviewWindowHelper.getStandaloneHost();
    if (host) xpcMain.broadcast(ONLY_PREVIEW_HOST_TOGGLE_CHANGED_EVENT, { hostId: host.hostId });
  }
}

export const onlyPreviewHostToggleService = new OnlyPreviewHostToggleService();
