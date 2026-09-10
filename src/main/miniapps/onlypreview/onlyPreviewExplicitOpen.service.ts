import { xpcMain } from 'electron-xpc/main';
import { resolve } from 'node:path';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_SELECTION_CHANGED_EVENT,
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT
} from '@shared/onlypreview/onlyPreview.types';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { onlyPreviewWindowHelper } from '@main/windows/onlyPreviewWindow.helper';
import { resolveOnlyPreviewPreviewRegion } from './views/onlyPreviewPreviewRegion.service';
import { onlyPreviewWorkspaceRegistry } from './onlyPreviewWorkspace.registry';
import { onlyPreviewSelectionCoordinator } from './onlyPreviewSelectionCoordinator.service';
import { onlyPreviewRecentDirectoryService } from './onlyPreviewRecentDirectory.service';
import { recordOnlyPreviewRecentFile } from './onlyPreviewRecents.runtime';
import { registerOnlyPreviewExplicitTarget } from './onlyPreviewExplicitTarget.registry';
import {
  OnlyPreviewTargetMutationQueue,
  serializeOnlyPreviewOpenTarget
} from './onlyPreviewOpenRouter.service';
import { onlyPreviewOpenDiagnostics } from './onlyPreviewOpenDiagnostics.runtime';
import type { OnlyPreviewOpenTrace } from '@shared/onlypreview/onlyPreviewOpenDiagnostics.mjs';
import type { OnlyPreviewValidatedTarget } from '@shared/onlypreview/onlyPreviewFileAuthorityRuntime.types';
import type { OnlyPreviewHostCapability } from './onlyPreviewHost.registry';
import { onlyPreviewHostRegistry } from './onlyPreviewHost.registry';

export const onlyPreviewTargetMutations = new OnlyPreviewTargetMutationQueue();

// The caller already owns the target FIFO. Relocation uses fresh inspection and a fresh host,
// while ordinary explicit opens keep their original queue and diagnostic lifecycle.
export const presentOnlyPreviewExplicitFile = async (
  host: OnlyPreviewHostCapability,
  inspected: OnlyPreviewValidatedTarget,
  trace?: OnlyPreviewOpenTrace,
  fragment?: string,
  preserveTreeSelection = false
): Promise<boolean> => {
  if (!inspected.selectedRelativePath) {
    throw new OnlyPreviewContractError(
      'PATH_NOT_REGULAR_FILE',
      'The selected target is no longer a file.'
    );
  }
  const selectionGeneration = onlyPreviewSelectionCoordinator.advance(host.hostToken);
  const projectId = onlyPreviewWorkspaceRegistry.restore(host.hostToken)?.workspaceId;
  const isCurrent = (): boolean =>
    onlyPreviewHostRegistry.isLive(host.hostToken) &&
    onlyPreviewSelectionCoordinator.isCurrent(host.hostToken, selectionGeneration) &&
    onlyPreviewWorkspaceRegistry.restore(host.hostToken)?.workspaceId === projectId;
  const classification = onlyPreviewWorkspaceRegistry.classifyProjectTarget(
    host.hostToken,
    inspected
  );
  let fileRef = classification.kind === 'project' ? classification.fileRef : null;
  if (fileRef) {
    trace?.mark({ phase: 'authority', authority: 'project' });
    const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
      host.hostToken,
      fileRef
    );
    const file = await fileSearchWindowService.authorizeProjectItem({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration,
      relativePath: authority.relativePath
    });
    if (!isCurrent()) {
      trace?.end({ outcome: 'superseded' });
      return false;
    }
    if (file.nodeKind !== 'file') {
      throw new OnlyPreviewContractError(
        'PATH_NOT_REGULAR_FILE',
        'Only regular files can be selected for Preview.'
      );
    }
    onlyPreviewWorkspaceRegistry.revokeExternalPreview(host.hostToken);
    fileRef = { workspaceId: file.workspaceId, relativePath: file.relativePath };
    onlyPreviewWorkspaceRegistry.select(host.hostToken, fileRef);
  } else {
    trace?.mark({ phase: 'authority', authority: 'external' });
    fileRef = onlyPreviewWorkspaceRegistry.registerExternalPreview(host.hostToken, inspected);
    // Both outside and unsettled targets keep the Project's selection and index intact.
  }

  // 预览区按 host 解析(不再是进程级单例)。OnlyPreview 自己的 host 在 `start()` 时已登记,
  // 所以这里拿到的就是原来那一份 —— 行为不变,只是不再假设"全进程只有一个预览区"。
  await resolveOnlyPreviewPreviewRegion(host.hostToken).present(host.hostToken, fileRef, trace?.tag, fragment);
  trace?.mark({ phase: 'presentation-issued' });
  if (!isCurrent()) {
    trace?.end({ outcome: 'superseded' });
    return false;
  }
  const workspace = onlyPreviewWorkspaceRegistry.restore(host.hostToken);
  if (workspace?.workspaceId === fileRef.workspaceId) {
    onlyPreviewRecentDirectoryService.rememberSelectedFile(
      workspace.displayPath,
      fileRef.relativePath
    );
  }
  if (!preserveTreeSelection) {
    xpcMain.broadcast(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, { hostId: host.hostId });
  }
  onlyPreviewWindowHelper.show();
  trace?.mark({ phase: 'accepted' });
  trace?.end({ outcome: 'accepted' });
  return true;
};

const performOpenOnlyPreviewAbsoluteTarget = async (
  target: string,
  context: { trace: OnlyPreviewOpenTrace; preserveTreeSelection: boolean }
): Promise<void> => {
  const { trace, preserveTreeSelection } = context;
  const recentGeneration = onlyPreviewRecentDirectoryService.beginExplicitTarget();
  try {
    trace.mark({ phase: 'fifo' });
    const host = await onlyPreviewWindowHelper.ensureStandalone('explicit');
    trace.mark({ phase: 'window' });
    onlyPreviewRecentDirectoryService.bindExplicitTarget(host.hostToken, recentGeneration);
    const projectId = onlyPreviewWorkspaceRegistry.restore(host.hostToken)?.workspaceId;
    const inspected = await fileSearchWindowService.inspectTarget(target);
    onlyPreviewHostRegistry.require(host.hostToken, ['content']);
    if (onlyPreviewWorkspaceRegistry.restore(host.hostToken)?.workspaceId !== projectId) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'The active Project changed before opening this target.'
      );
    }
    trace.mark({ phase: 'inspect', kind: inspected.selectedRelativePath ? 'file' : 'directory' });

    if (!inspected.selectedRelativePath) {
      // Re-opening the directory that is ALREADY the active project is a no-op — bring the surface
      // forward and stop (Ral 2026-09-07).
      //
      // Without this, opening the same workspace again re-binds the project authority, and a
      // re-bind mints a NEW `workspaceGeneration`. That is not merely wasted work: every reference
      // taken before the re-open now fails the generation comparison, which is the
      // `WORKSPACE_ACCESS_DENIED · Project authority does not match the active workspace` reported
      // alongside this. It also puts the workspace back into `projectAuthorityPending`, and while
      // it is pending `resolveProjectFileRef` returns null — so an external preview arriving in
      // that window gets classified as external and clears the project's tree selection
      // (docs/issues/onlypreview-external-preview-clears-project-selection.md). One re-bind, three
      // visible faults.
      //
      // The comparison is on REAL paths, both produced the same way: `inspected.rootRealPath` comes
      // from `inspectTarget`, and the bound root was stored from the same field at bind time. That
      // is what makes a symlinked spelling — or macOS's `/tmp` vs `/private/tmp` — hit this
      // short-circuit instead of sliding past it into a needless re-bind.
      //
      // Deliberately NOT done here: `selectionCoordinator.advance` and
      // `previewRegionService.clearWorkspace`. Those are how an open *replaces* what is on screen;
      // re-opening what is already open must leave the current selection and preview alone.
      if (onlyPreviewWorkspaceRegistry.isActiveProjectRoot(host.hostToken, inspected.rootRealPath)) {
        trace.mark({ phase: 'authority', authority: 'directory' });
        onlyPreviewWindowHelper.show();
        trace.mark({ phase: 'accepted', authority: 'directory' });
        trace.end({ outcome: 'accepted' });
        return;
      }
      const workspace = await onlyPreviewRecentDirectoryService.openExplicitTarget(
        host.hostToken,
        target,
        recentGeneration
      );
      if (workspace) {
        trace.mark({ phase: 'authority', authority: 'directory' });
        onlyPreviewSelectionCoordinator.advance(host.hostToken);
        resolveOnlyPreviewPreviewRegion(host.hostToken).clearWorkspace(host.hostToken, workspace.workspaceId);
        xpcMain.broadcast(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT, { hostId: host.hostId });
        onlyPreviewWindowHelper.show();
      }
      trace.mark({ phase: 'accepted', authority: 'directory' });
      trace.end({ outcome: 'accepted' });
      return;
    }

    // 一个**文件**目标不绑项目,所以它不该挡住「恢复上次打开的项目」。
    //
    // `beginExplicitTarget` 上面无条件占了那道闸门(它同时是 supersede 记账,必须占),而闸门只对
    // 要自己绑项目的目标成立。不放开的话:这条路在新窗口里跑时,shell 挂载即问 `restoreWorkspace`
    // 会拿到 `null`,顶栏落成「No project open」,而文件那支结束时广播的是 `SELECTION_CHANGED`
    // 不是 `WORKSPACE_CHANGED` —— shell 再也不会问第二次,空状态就留在那里。
    // 详见 `docs/issues/onlypreview-external-file-open-drops-the-project.md`。
    onlyPreviewRecentDirectoryService.releaseProjectRestoreClaim(recentGeneration);
    if (
      await presentOnlyPreviewExplicitFile(host, inspected, trace, undefined, preserveTreeSelection)
    ) {
      await recordOnlyPreviewRecentFile(host.hostToken, resolve(inspected.rootRealPath, inspected.selectedRelativePath));
    }
    // 补一次「再问」的机会 —— **不 await**:项目索引可能是几万个文件,让一个 PDF 的预览等在索引
    // 后面是另一种坏。预览先出,项目随后出现。
    // **只有真恢复出项目时才广播**:没有可恢复的项目时广播 `workspaceChanged` 会让 shell 再走一遍
    // 「置空 ＋ 重置索引状态」,那是在说一件没发生的事。
    if (!onlyPreviewWorkspaceRegistry.restore(host.hostToken)) {
      void onlyPreviewRecentDirectoryService
        // **不要呈现那个项目记住的文件** —— 这一步只是"让项目回到树里"。呈现会把上面刚呈现的
        // 那个外部文件换掉,而那次替换是静默的:表现就是"第一次打开没反应,第二次才行"
        // (`docs/issues/onlypreview-first-external-open-is-replaced-by-the-restored-project.md`)。
        .restoreWorkspace(host.hostToken, { presentRestoredSelection: false })
        .then((workspace) => {
          if (!workspace || !onlyPreviewHostRegistry.isLive(host.hostToken)) return;
          xpcMain.broadcast(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT, { hostId: host.hostId });
        })
        .catch(() => undefined);
    }
  } catch (error) {
    trace.end({ outcome: 'failure' });
    throw error;
  } finally {
    onlyPreviewRecentDirectoryService.finishExplicitTarget(recentGeneration);
  }
};

const serializedOpenOnlyPreviewAbsoluteTarget = serializeOnlyPreviewOpenTarget(
  performOpenOnlyPreviewAbsoluteTarget,
  onlyPreviewTargetMutations
);

export const openOnlyPreviewAbsoluteTarget = (
  target: string,
  options: { preserveTreeSelection?: boolean } = {}
): Promise<void> => {
  const trace = onlyPreviewOpenDiagnostics.trace('target', { kind: 'unknown' }, 't');
  return serializedOpenOnlyPreviewAbsoluteTarget(target, {
    trace,
    preserveTreeSelection: options.preserveTreeSelection === true
  });
};

registerOnlyPreviewExplicitTarget(openOnlyPreviewAbsoluteTarget);
