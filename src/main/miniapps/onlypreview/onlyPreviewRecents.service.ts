import { createHash } from 'node:crypto';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewPreviewPresentation,
  OnlyPreviewRecentsSnapshot
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewHostRegistry } from './onlyPreviewHost.registry';
import type { OnlyPreviewWorkspaceRegistry } from './onlyPreviewWorkspace.registry';
import type { OnlyPreviewRecentDirectoryStorage } from './onlyPreviewRecentDirectory.service';

const STORAGE_KEY = 'onlypreview_recents';
const LIMIT = 100;
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const validPath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 32768 &&
  isAbsolute(value) &&
  !/\p{Cc}/u.test(value) &&
  resolve(value) === value;

const readPaths = (value: unknown): string[] => {
  if (value === null || value === undefined) return [];
  const stored = value as { version?: unknown; paths?: unknown };
  if (stored.version !== 1 || !Array.isArray(stored.paths)) {
    throw new OnlyPreviewContractError('PROTOCOL_ERROR', 'Recent files storage is invalid.');
  }
  const paths = stored.paths.slice(0, LIMIT);
  if (!paths.every(validPath)) {
    throw new OnlyPreviewContractError('PROTOCOL_ERROR', 'Recent files storage is invalid.');
  }
  return [...new Set(paths)];
};

export class OnlyPreviewRecentsService {
  private storage: OnlyPreviewRecentDirectoryStorage | null = null;
  private ready: Promise<boolean>;
  private settleReady!: (ready: boolean) => void;
  private readonly buckets = new Map<string, string[]>();
  private readonly hostVersions = new Map<string, { signature: string; revision: number }>();
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly hosts: OnlyPreviewHostRegistry,
    private readonly workspaces: OnlyPreviewWorkspaceRegistry,
    private readonly presentation: (hostToken: string) => OnlyPreviewPreviewPresentation,
    private readonly changed: (hostId: string) => void = () => undefined
  ) {
    this.ready = new Promise((resolveReady) => {
      this.settleReady = resolveReady;
    });
    hosts.onRevoke((host) => this.hostVersions.delete(host.hostToken));
  }

  configureStorage(storage: OnlyPreviewRecentDirectoryStorage): void {
    if (!this.storage) this.storage = storage;
  }

  markStorageReady(): void {
    this.settleReady(true);
  }
  markStorageFailed(): void {
    this.settleReady(false);
  }
  async flushPendingWrites(): Promise<void> {
    await this.writes;
  }

  private scope(hostToken: string): string | null {
    const project = this.workspaces.restore(hostToken);
    return project
      ? this.workspaces.requireWorkspace(hostToken, project.workspaceId).rootRealPath
      : null;
  }

  currentPath(hostToken: string): string | null {
    this.hosts.require(hostToken, ['content']);
    const fileRef = this.presentation(hostToken).fileRef;
    if (!fileRef) return null;
    const workspace = this.workspaces.requireWorkspace(hostToken, fileRef.workspaceId);
    return resolve(workspace.rootRealPath, fileRef.relativePath);
  }

  private key(scope: string | null): string {
    return scope === null ? 'unbound' : digest(scope);
  }
  private id(scope: string | null, path: string): string {
    return digest(`${this.key(scope)}\0${path}`);
  }

  private cache(key: string, paths: string[]): void {
    this.buckets.delete(key);
    this.buckets.set(key, paths);
    if (this.buckets.size > 16) this.buckets.delete(this.buckets.keys().next().value!);
  }

  private async paths(scope: string | null): Promise<string[]> {
    if (!(await this.ready) || !this.storage) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'Recent files storage is unavailable.'
      );
    }
    const key = this.key(scope);
    const cached = this.buckets.get(key);
    if (cached) return cached;
    const stored = await this.storage.getStored({ key: STORAGE_KEY, sub_key: key });
    if (stored.exists && !stored.valid) {
      throw new OnlyPreviewContractError('PROTOCOL_ERROR', 'Recent files storage is invalid.');
    }
    const paths = readPaths(stored.exists ? stored.value : null);
    this.cache(key, paths);
    return paths;
  }

  async snapshot(hostToken: string): Promise<OnlyPreviewRecentsSnapshot> {
    const host = this.hosts.require(hostToken, ['content']);
    const scope = this.scope(hostToken);
    const paths = await this.paths(scope);
    this.hosts.require(hostToken, ['content']);
    if (scope !== this.scope(hostToken)) return await this.snapshot(hostToken);
    const currentPath = this.currentPath(hostToken);
    const signature = JSON.stringify([scope, paths, currentPath]);
    const previous = this.hostVersions.get(hostToken);
    const revision =
      previous?.signature === signature ? previous.revision : (previous?.revision ?? 0) + 1;
    this.hostVersions.set(hostToken, { signature, revision });
    const index = currentPath ? paths.indexOf(currentPath) : -1;
    const fileRef = this.presentation(hostToken).fileRef;
    return {
      hostId: host.hostId,
      revision,
      entries: paths.map((path) => ({
        id: this.id(scope, path),
        name: basename(path),
        relativePath: scope && !isAbsolute(relative(scope, path)) ? relative(scope, path) : path
      })),
      activeEntryId: index < 0 ? null : this.id(scope, paths[index]),
      canBack: index >= 0 && index + 1 < paths.length,
      canForward: index > 0,
      canReload: Boolean(fileRef),
      canLocate: Boolean(
        fileRef && this.workspaces.restore(hostToken)?.workspaceId === fileRef.workspaceId
      )
    };
  }

  async resolveEntry(hostToken: string, entryId: unknown, revision: unknown): Promise<string> {
    const scope = this.scope(hostToken);
    const snapshot = await this.snapshot(hostToken);
    if (
      !Number.isSafeInteger(revision) ||
      revision !== snapshot.revision ||
      typeof entryId !== 'string' ||
      scope !== this.scope(hostToken)
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Recent file selection is stale.');
    }
    const index = snapshot.entries.findIndex((entry) => entry.id === entryId);
    if (index < 0)
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Recent file is not in this Project.');
    const path = this.buckets.get(this.key(scope))?.[index];
    if (!path || this.id(scope, path) !== entryId) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Recent file selection is stale.');
    }
    return path;
  }

  async navigate(hostToken: string, direction: unknown, revision: unknown): Promise<string | null> {
    const snapshot = await this.snapshot(hostToken);
    if (
      revision !== snapshot.revision ||
      !Number.isSafeInteger(revision) ||
      (direction !== 'back' && direction !== 'forward')
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Recent navigation is stale or invalid.');
    }
    const index = snapshot.entries.findIndex((entry) => entry.id === snapshot.activeEntryId);
    const target =
      index < 0 ? undefined : snapshot.entries[index + (direction === 'back' ? 1 : -1)];
    return target ? await this.resolveEntry(hostToken, target.id, revision) : null;
  }

  record(hostToken: string, canonicalPath: string): Promise<void> {
    this.hosts.require(hostToken, ['content']);
    if (!validPath(canonicalPath))
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Recent path is invalid.');
    const scope = this.scope(hostToken);
    const task = this.writes.then(async () => {
      await this.paths(scope);
      const storage = this.storage!;
      const sub_key = this.key(scope);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (
          !this.hosts.isLive(hostToken) ||
          scope !== this.scope(hostToken) ||
          this.currentPath(hostToken) !== canonicalPath
        )
          return;
        const stored = await storage.getStored({ key: STORAGE_KEY, sub_key });
        const paths = [
          canonicalPath,
          ...readPaths(stored.exists ? stored.value : null).filter((path) => path !== canonicalPath)
        ].slice(0, LIMIT);
        if (
          !this.hosts.isLive(hostToken) ||
          scope !== this.scope(hostToken) ||
          this.currentPath(hostToken) !== canonicalPath
        )
          return;
        const value = { version: 1, paths };
        const written =
          stored.exists && stored.serializedValue !== null
            ? await storage.compareAndSet({
                key: STORAGE_KEY,
                sub_key,
                expectedSerializedValue: stored.serializedValue,
                value
              })
            : await storage.insertIfAbsent({ key: STORAGE_KEY, sub_key, value });
        if (written) {
          this.cache(sub_key, paths);
          if (this.hosts.isLive(hostToken)) this.changed(this.hosts.require(hostToken).hostId);
          return;
        }
      }
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'Recent files storage changed concurrently.'
      );
    });
    this.writes = task.catch(() => undefined);
    return task;
  }
}
