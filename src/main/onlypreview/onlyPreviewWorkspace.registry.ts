import { isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  OnlyPreviewContractError,
  normalizeOnlyPreviewRelativePath,
  parseOnlyPreviewFileRef
} from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewFileRef,
  OnlyPreviewWorkspace
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewValidatedTarget } from '@shared/onlypreview/onlyPreviewFileAuthorityRuntime.types';
import {
  onlyPreviewHostRegistry,
  type OnlyPreviewHostCapability,
  type OnlyPreviewHostRegistry
} from './onlyPreviewHost.registry';

const MAX_WORKSPACES = 128;

type OnlyPreviewWorkspaceKind = 'project' | 'external-preview';

export interface OnlyPreviewWorkspaceRecord {
  workspaceId: string;
  hostToken: string;
  kind: OnlyPreviewWorkspaceKind;
  rootRealPath: string;
  rootName: string;
  displayPath: string;
  selectedRelativePath?: string;
  previewAuthorityGeneration?: number;
  projectAuthorityGeneration?: number;
  projectAuthorityPending?: true;
  createdAt: number;
}

export interface OnlyPreviewProjectAuthorityRef {
  host: OnlyPreviewHostCapability;
  workspace: OnlyPreviewWorkspaceRecord;
  workspaceId: string;
  workspaceGeneration: number;
  relativePath: string;
}

export interface OnlyPreviewPreviewAuthorityRef {
  host: OnlyPreviewHostCapability;
  workspace: OnlyPreviewWorkspaceRecord;
  workspaceId: string;
  workspaceGeneration: number;
  relativePath: string;
  rootPath: string;
}

type WorkspaceRevocationListener = (workspace: OnlyPreviewWorkspaceRecord) => void;

const toSnapshot = (workspace: OnlyPreviewWorkspaceRecord): OnlyPreviewWorkspace => ({
  workspaceId: workspace.workspaceId,
  rootName: workspace.rootName,
  displayPath: workspace.displayPath,
  ...(workspace.selectedRelativePath
    ? { selectedRelativePath: workspace.selectedRelativePath }
    : {})
});

/**
 * Where a target sits relative to the bound project.
 *
 * `unsettled` is deliberately NOT merged into `outside`: the caller reacts to "outside" by
 * clearing project state, and doing that on a transient answer is the bug this type exists to
 * prevent.
 */
export type OnlyPreviewProjectTargetClassification =
  | { kind: 'project'; fileRef: OnlyPreviewFileRef }
  | { kind: 'outside' }
  | { kind: 'unsettled' };

export class OnlyPreviewWorkspaceRegistry {
  private readonly workspaces = new Map<string, OnlyPreviewWorkspaceRecord>();
  private readonly projectWorkspaceByHost = new Map<string, string>();
  private readonly externalPreviewWorkspaceByHost = new Map<string, string>();
  private readonly revocationListeners = new Set<WorkspaceRevocationListener>();

  constructor(private readonly hosts: OnlyPreviewHostRegistry) {
    hosts.onRevoke((host) => this.revokeHost(host.hostToken));
  }

  registerValidatedTarget(
    hostToken: unknown,
    target: OnlyPreviewValidatedTarget
  ): OnlyPreviewWorkspace {
    const host = this.hosts.require(hostToken, ['content']);
    const selectedRelativePath = this.validateTarget(target);
    const replacingOwnWorkspace = [...this.workspaces.values()].some(
      (workspace) => workspace.hostToken === host.hostToken
    );
    if (this.workspaces.size >= MAX_WORKSPACES && !replacingOwnWorkspace) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'OnlyPreview has too many live workspaces.'
      );
    }
    const record: OnlyPreviewWorkspaceRecord = {
      workspaceId: randomUUID(),
      hostToken: host.hostToken,
      kind: 'project',
      rootRealPath: target.rootRealPath,
      rootName: target.rootName,
      displayPath: target.displayPath,
      ...(selectedRelativePath ? { selectedRelativePath } : {}),
      projectAuthorityPending: true,
      createdAt: Date.now()
    };
    this.revokeHost(host.hostToken);
    this.workspaces.set(record.workspaceId, record);
    this.projectWorkspaceByHost.set(host.hostToken, record.workspaceId);
    return toSnapshot(record);
  }

  registerExternalPreview(
    hostToken: unknown,
    target: OnlyPreviewValidatedTarget
  ): OnlyPreviewFileRef {
    const host = this.hosts.require(hostToken, ['content']);
    const selectedRelativePath = this.validateTarget(target);
    if (!selectedRelativePath || selectedRelativePath.includes('/')) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'External Preview target must be one regular file.'
      );
    }
    const replacingOwnWorkspace = this.externalPreviewWorkspaceByHost.has(host.hostToken);
    if (this.workspaces.size >= MAX_WORKSPACES && !replacingOwnWorkspace) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'OnlyPreview has too many live workspaces.'
      );
    }
    this.revokeExternalPreview(host.hostToken);
    const record: OnlyPreviewWorkspaceRecord = {
      workspaceId: randomUUID(),
      hostToken: host.hostToken,
      kind: 'external-preview',
      rootRealPath: target.rootRealPath,
      rootName: target.rootName,
      displayPath: target.displayPath,
      selectedRelativePath,
      previewAuthorityGeneration: 1,
      createdAt: Date.now()
    };
    this.workspaces.set(record.workspaceId, record);
    this.externalPreviewWorkspaceByHost.set(host.hostToken, record.workspaceId);
    return { workspaceId: record.workspaceId, relativePath: selectedRelativePath };
  }

  /**
   * Is this target a file inside the bound project, outside it, or not yet knowable?
   *
   * The three answers used to be one: `resolveProjectFileRef` returned `null` for all of them. That
   * conflation is the defect behind
   * `docs/issues/onlypreview-external-preview-clears-project-selection.md` — the caller treats
   * "no" as "external" and clears the project's tree selection, so a target that IS inside the
   * project loses its selection whenever the answer happened to be `unsettled` rather than
   * `outside`. `unsettled` is a moment in time; `outside` is a fact about the path. Only the second
   * one justifies clearing anything.
   */
  classifyProjectTarget(
    hostToken: unknown,
    target: OnlyPreviewValidatedTarget
  ): OnlyPreviewProjectTargetClassification {
    const host = this.hosts.require(hostToken, ['content']);
    const selectedRelativePath = this.validateTarget(target);
    // Not a regular file at all — nothing about the project can make it one.
    if (!selectedRelativePath) return { kind: 'outside' };
    const workspaceId = this.projectWorkspaceByHost.get(host.hostToken);
    // No project bound: there is no selection to preserve, so this is settled rather than unknown.
    if (!workspaceId) return { kind: 'outside' };
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace || workspace.kind !== 'project') return { kind: 'outside' };
    // THE transient case. The project is bound but its authority has not settled, so containment
    // cannot be decided yet — and answering "outside" here is what clears a selection that should
    // have survived.
    if (workspace.projectAuthorityPending) return { kind: 'unsettled' };
    const absoluteTarget = resolve(target.rootRealPath, selectedRelativePath);
    const projectRelativePath = relative(workspace.rootRealPath, absoluteTarget);
    if (
      !projectRelativePath ||
      isAbsolute(projectRelativePath) ||
      projectRelativePath === '..' ||
      projectRelativePath.startsWith(`..${sep}`)
    ) {
      return { kind: 'outside' };
    }
    return {
      kind: 'project',
      fileRef: {
        workspaceId: workspace.workspaceId,
        relativePath: normalizeOnlyPreviewRelativePath(projectRelativePath.split(sep).join('/'))
      }
    };
  }

  /**
   * The two-answer form, kept for callers that only need "is it in the project".
   *
   * Anything that also decides whether to CLEAR project state must use `classifyProjectTarget`
   * instead — this signature cannot express the difference that matters there.
   */
  resolveProjectFileRef(
    hostToken: unknown,
    target: OnlyPreviewValidatedTarget
  ): OnlyPreviewFileRef | null {
    const classification = this.classifyProjectTarget(hostToken, target);
    return classification.kind === 'project' ? classification.fileRef : null;
  }

  getPreviewAuthorityItemRef(hostToken: unknown, value: unknown): OnlyPreviewPreviewAuthorityRef {
    const host = this.hosts.require(hostToken, ['content']);
    const fileRef = parseOnlyPreviewFileRef(value);
    const workspace = this.requireWorkspace(host.hostToken, fileRef.workspaceId);
    if (
      workspace.kind === 'external-preview' &&
      (this.externalPreviewWorkspaceByHost.get(host.hostToken) !== workspace.workspaceId ||
        workspace.selectedRelativePath !== fileRef.relativePath)
    ) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'External Preview file capability is no longer current.'
      );
    }
    const workspaceGeneration =
      workspace.kind === 'project'
        ? this.requireProjectAuthorityGeneration(workspace)
        : this.requirePreviewAuthorityGeneration(workspace);
    return {
      host,
      workspace,
      workspaceId: workspace.workspaceId,
      workspaceGeneration,
      relativePath: fileRef.relativePath,
      rootPath: workspace.rootRealPath
    };
  }

  getOfficeReadBootstrap(hostToken: unknown, value: unknown): OnlyPreviewPreviewAuthorityRef {
    const authority = this.getPreviewAuthorityItemRef(hostToken, value);
    return {
      ...authority
    };
  }

  bindProjectAuthority(hostToken: unknown, workspaceId: unknown, generation: unknown): void {
    const workspace = this.requireProjectWorkspace(hostToken, workspaceId);
    if (!Number.isSafeInteger(generation) || (generation as number) < 1) {
      throw new OnlyPreviewContractError(
        'PROTOCOL_ERROR',
        'Project authority generation is invalid.'
      );
    }
    workspace.projectAuthorityGeneration = generation as number;
    workspace.previewAuthorityGeneration = generation as number;
    delete workspace.projectAuthorityPending;
  }

  getProjectAuthorityItemRef(hostToken: unknown, value: unknown): OnlyPreviewProjectAuthorityRef {
    const host = this.hosts.require(hostToken, ['content']);
    const fileRef = parseOnlyPreviewFileRef(value);
    const workspace = this.requireProjectWorkspace(host.hostToken, fileRef.workspaceId);
    const workspaceGeneration = this.requireProjectAuthorityGeneration(workspace);
    return {
      host,
      workspace,
      workspaceId: workspace.workspaceId,
      workspaceGeneration,
      relativePath: fileRef.relativePath
    };
  }

  getProjectAuthorityRootRef(
    hostToken: unknown,
    workspaceId: unknown
  ): Omit<OnlyPreviewProjectAuthorityRef, 'relativePath'> & { relativePath: '' } {
    const host = this.hosts.require(hostToken, ['content']);
    const workspace = this.requireProjectWorkspace(host.hostToken, workspaceId);
    const workspaceGeneration = this.requireProjectAuthorityGeneration(workspace);
    return {
      host,
      workspace,
      workspaceId: workspace.workspaceId,
      workspaceGeneration,
      relativePath: ''
    };
  }

  restore(hostToken: unknown): OnlyPreviewWorkspace | null {
    const host = this.hosts.require(hostToken, ['content']);
    const workspaceId = this.projectWorkspaceByHost.get(host.hostToken);
    if (!workspaceId) return null;
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.kind === 'project' && !workspace.projectAuthorityPending
      ? toSnapshot(workspace)
      : null;
  }

  /**
   * Is `rootRealPath` already this host's bound, settled project root?
   *
   * A predicate rather than a `rootRealPath` getter on purpose. `toSnapshot` deliberately keeps the
   * real path out of `OnlyPreviewWorkspace` — that path is what file authority is built on, so
   * handing it out to answer a comparison would widen the surface to save a line.
   *
   * Returns false while the authority is still pending, matching `restore()`. "Not settled yet" is
   * not "already open": short-circuiting on a half-bound workspace would skip the bind that is
   * still needed.
   */
  isActiveProjectRoot(hostToken: unknown, rootRealPath: string): boolean {
    const host = this.hosts.require(hostToken, ['content']);
    if (typeof rootRealPath !== 'string' || !rootRealPath) return false;
    const workspaceId = this.projectWorkspaceByHost.get(host.hostToken);
    if (!workspaceId) return false;
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace || workspace.kind !== 'project' || workspace.projectAuthorityPending) {
      return false;
    }
    return workspace.rootRealPath === rootRealPath;
  }

  requireWorkspace(hostToken: unknown, workspaceId: unknown): OnlyPreviewWorkspaceRecord {
    const host = this.hosts.require(hostToken, ['content']);
    if (typeof workspaceId !== 'string' || workspaceId.length < 16 || workspaceId.length > 256) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Workspace capability is invalid.');
    }
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_NOT_FOUND',
        'OnlyPreview workspace is no longer available.'
      );
    }
    if (workspace.hostToken !== host.hostToken) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'Workspace belongs to another OnlyPreview host.'
      );
    }
    return workspace;
  }

  select(hostToken: unknown, value: OnlyPreviewFileRef): void {
    const fileRef = parseOnlyPreviewFileRef(value);
    const workspace = this.requireProjectWorkspace(hostToken, fileRef.workspaceId);
    workspace.selectedRelativePath = fileRef.relativePath;
    this.projectWorkspaceByHost.set(workspace.hostToken, workspace.workspaceId);
  }

  clearSelection(hostToken: unknown, value: OnlyPreviewFileRef): boolean {
    const fileRef = parseOnlyPreviewFileRef(value);
    const workspace = this.requireProjectWorkspace(hostToken, fileRef.workspaceId);
    if (workspace.selectedRelativePath !== fileRef.relativePath) return false;
    delete workspace.selectedRelativePath;
    return true;
  }

  clearProjectSelection(hostToken: unknown): boolean {
    const host = this.hosts.require(hostToken, ['content']);
    const workspaceId = this.projectWorkspaceByHost.get(host.hostToken);
    if (!workspaceId) return false;
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace || workspace.kind !== 'project' || !workspace.selectedRelativePath) return false;
    delete workspace.selectedRelativePath;
    return true;
  }

  isExternalPreviewFileRef(hostToken: unknown, value: unknown): boolean {
    const host = this.hosts.require(hostToken, ['content']);
    const fileRef = parseOnlyPreviewFileRef(value);
    const workspace = this.workspaces.get(fileRef.workspaceId);
    return workspace?.hostToken === host.hostToken && workspace.kind === 'external-preview';
  }

  getExternalPreviewNativePath(hostToken: unknown, value: unknown): string | null {
    const host = this.hosts.require(hostToken, ['content']);
    const fileRef = parseOnlyPreviewFileRef(value);
    const workspace = this.requireWorkspace(host.hostToken, fileRef.workspaceId);
    if (workspace.kind !== 'external-preview') return null;
    if (
      this.externalPreviewWorkspaceByHost.get(host.hostToken) !== workspace.workspaceId ||
      workspace.selectedRelativePath !== fileRef.relativePath
    ) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'External Preview file capability is no longer current.'
      );
    }
    return resolve(workspace.rootRealPath, fileRef.relativePath);
  }

  revalidateExternalPreviewNativePath(
    hostToken: unknown,
    value: unknown,
    target: OnlyPreviewValidatedTarget
  ): string {
    const host = this.hosts.require(hostToken, ['content']);
    const fileRef = parseOnlyPreviewFileRef(value);
    const selectedRelativePath = this.validateTarget(target);
    const workspace = this.requireWorkspace(host.hostToken, fileRef.workspaceId);
    if (
      workspace.kind !== 'external-preview' ||
      this.externalPreviewWorkspaceByHost.get(host.hostToken) !== workspace.workspaceId ||
      workspace.selectedRelativePath !== fileRef.relativePath ||
      target.rootRealPath !== workspace.rootRealPath ||
      selectedRelativePath !== workspace.selectedRelativePath
    ) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'External Preview file authority changed before the native action.'
      );
    }
    return resolve(workspace.rootRealPath, fileRef.relativePath);
  }

  revokeExternalPreview(hostToken: unknown): boolean {
    const host = this.hosts.require(hostToken, ['content']);
    const workspaceId = this.externalPreviewWorkspaceByHost.get(host.hostToken);
    return workspaceId ? this.revokeWorkspace(workspaceId) : false;
  }

  revokeHost(hostToken: string): void {
    for (const workspace of [...this.workspaces.values()]) {
      if (workspace.hostToken === hostToken) this.revokeWorkspace(workspace.workspaceId);
    }
    this.projectWorkspaceByHost.delete(hostToken);
    this.externalPreviewWorkspaceByHost.delete(hostToken);
  }

  revokeWorkspace(workspaceId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;
    this.workspaces.delete(workspaceId);
    if (this.projectWorkspaceByHost.get(workspace.hostToken) === workspaceId) {
      this.projectWorkspaceByHost.delete(workspace.hostToken);
    }
    if (this.externalPreviewWorkspaceByHost.get(workspace.hostToken) === workspaceId) {
      this.externalPreviewWorkspaceByHost.delete(workspace.hostToken);
    }
    for (const listener of this.revocationListeners) listener(workspace);
    return true;
  }

  onRevoke(listener: WorkspaceRevocationListener): () => void {
    this.revocationListeners.add(listener);
    return () => this.revocationListeners.delete(listener);
  }

  clear(): void {
    for (const workspaceId of [...this.workspaces.keys()]) this.revokeWorkspace(workspaceId);
  }

  private requireProjectAuthorityGeneration(workspace: OnlyPreviewWorkspaceRecord): number {
    const generation = workspace.projectAuthorityGeneration;
    if (!Number.isSafeInteger(generation) || (generation as number) < 1) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'Project authority is not available for this workspace.'
      );
    }
    return generation as number;
  }

  private requirePreviewAuthorityGeneration(workspace: OnlyPreviewWorkspaceRecord): number {
    const generation = workspace.previewAuthorityGeneration;
    if (!Number.isSafeInteger(generation) || (generation as number) < 1) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'Preview authority is not available for this workspace.'
      );
    }
    return generation as number;
  }

  private requireProjectWorkspace(
    hostToken: unknown,
    workspaceId: unknown
  ): OnlyPreviewWorkspaceRecord {
    const workspace = this.requireWorkspace(hostToken, workspaceId);
    if (workspace.kind !== 'project') {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'External Preview authority cannot be used as a Project workspace.'
      );
    }
    return workspace;
  }

  private validateTarget(target: OnlyPreviewValidatedTarget): string | undefined {
    if (
      !target ||
      !isAbsolute(target.rootRealPath) ||
      target.displayPath !== target.rootRealPath ||
      typeof target.rootName !== 'string' ||
      !target.rootName
    ) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Validated OnlyPreview target is invalid.'
      );
    }
    return target.selectedRelativePath
      ? normalizeOnlyPreviewRelativePath(target.selectedRelativePath)
      : undefined;
  }
}

export const onlyPreviewWorkspaceRegistry = new OnlyPreviewWorkspaceRegistry(
  onlyPreviewHostRegistry
);
