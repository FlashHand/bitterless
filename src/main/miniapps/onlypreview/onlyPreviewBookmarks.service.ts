import { createHash } from 'node:crypto';
import {
  OnlyPreviewContractError,
  parseOnlyPreviewFileRef
} from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewBookmark,
  OnlyPreviewBookmarkRequest,
  OnlyPreviewBookmarksRequest,
  OnlyPreviewBookmarksSnapshot
} from '@shared/onlypreview/onlyPreviewBookmarks.type';
import type { OnlyPreviewRecentDirectoryStorage } from './onlyPreviewRecentDirectory.service';
import type {
  OnlyPreviewWorkspaceRegistry,
  OnlyPreviewProjectAuthorityRef
} from './onlyPreviewWorkspace.registry';

const STORAGE_KEY = 'onlypreview_bookmarks';
type Scope = Omit<
  ReturnType<OnlyPreviewWorkspaceRegistry['getProjectAuthorityRootRef']>,
  'relativePath'
>;
type StoredEntry = Pick<OnlyPreviewBookmark, 'relativePath' | 'nodeKind'>;

const readEntries = (value: unknown, workspaceId: string): StoredEntry[] => {
  if (value === null) return [];
  const record = value as { version?: unknown; entries?: unknown };
  if (record?.version !== 1 || !Array.isArray(record.entries) || record.entries.length > 1000) {
    throw new OnlyPreviewContractError('PROTOCOL_ERROR', 'Bookmarks storage is invalid.');
  }
  const seen = new Set<string>();
  return record.entries
    .map((entry) => {
      const { relativePath } = parseOnlyPreviewFileRef({
        workspaceId,
        relativePath: entry?.relativePath
      });
      if (entry.nodeKind !== 'file' && entry.nodeKind !== 'directory') {
        throw new OnlyPreviewContractError('PROTOCOL_ERROR', 'Bookmark kind is invalid.');
      }
      return { relativePath, nodeKind: entry.nodeKind } as StoredEntry;
    })
    .filter((entry) => {
      if (seen.has(entry.relativePath)) return false;
      seen.add(entry.relativePath);
      return true;
    });
};

export class OnlyPreviewBookmarksService {
  private storage: OnlyPreviewRecentDirectoryStorage | null = null;
  private settleReady!: (ready: boolean) => void;
  private readonly ready = new Promise<boolean>((resolve) => {
    this.settleReady = resolve;
  });
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly workspaces: OnlyPreviewWorkspaceRegistry,
    private readonly authorize: (
      authority: OnlyPreviewProjectAuthorityRef
    ) => Promise<{ nodeKind: string }>,
    private readonly changed: (hostId: string, workspaceId: string) => void = () => undefined
  ) {}

  configureStorage(storage: OnlyPreviewRecentDirectoryStorage): void {
    this.storage ??= storage;
  }
  markStorageReady(): void {
    this.settleReady(true);
  }
  markStorageFailed(): void {
    this.settleReady(false);
  }

  private scope(request: OnlyPreviewBookmarksRequest): Scope {
    return this.workspaces.getProjectAuthorityRootRef(request?.hostToken, request?.workspaceId);
  }
  private requireCurrent(scope: Scope): void {
    const current = this.scope({ hostToken: scope.host.hostToken, workspaceId: scope.workspaceId });
    if (current.workspaceGeneration !== scope.workspaceGeneration) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Bookmark Project changed.');
    }
  }
  private async read(scope: Scope): Promise<{
    sub_key: string;
    stored: Awaited<ReturnType<OnlyPreviewRecentDirectoryStorage['getStored']>>;
    entries: StoredEntry[];
  }> {
    if (!(await this.ready) || !this.storage) {
      throw new OnlyPreviewContractError('OPERATION_FAILED', 'Bookmarks storage is unavailable.');
    }
    this.requireCurrent(scope);
    const sub_key = createHash('sha256').update(scope.workspace.rootRealPath).digest('hex');
    const stored = await this.storage.getStored({ key: STORAGE_KEY, sub_key });
    this.requireCurrent(scope);
    if (stored.exists && !stored.valid) {
      throw new OnlyPreviewContractError('PROTOCOL_ERROR', 'Bookmarks storage is invalid.');
    }
    return {
      sub_key,
      stored,
      entries: readEntries(stored.exists ? stored.value : null, scope.workspaceId)
    };
  }

  async snapshot(request: OnlyPreviewBookmarksRequest): Promise<OnlyPreviewBookmarksSnapshot> {
    const scope = this.scope(request);
    const { entries } = await this.read(scope);
    return {
      workspaceId: scope.workspaceId,
      entries: entries.map((entry) => ({ ...entry, name: entry.relativePath.split('/').at(-1)! }))
    };
  }

  async add(request: OnlyPreviewBookmarkRequest): Promise<void> {
    // This parser rejects the root, traversal and external-file capabilities before persistence.
    const authority = this.workspaces.getProjectAuthorityItemRef(request?.hostToken, request);
    const item = await this.authorize(authority);
    this.requireCurrent(authority);
    if (item.nodeKind !== 'file' && item.nodeKind !== 'directory') {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Only files and folders can be bookmarked.'
      );
    }
    const entry: StoredEntry = { relativePath: authority.relativePath, nodeKind: item.nodeKind };
    await this.mutate(authority, (entries) =>
      entries.some((current) => current.relativePath === entry.relativePath)
        ? entries
        : [...entries, entry]
    );
  }

  async remove(request: OnlyPreviewBookmarkRequest): Promise<void> {
    const scope = this.scope(request);
    const { relativePath } = parseOnlyPreviewFileRef(request);
    // Deliberately no disk authorization: deleted or moved files must still be removable.
    await this.mutate(scope, (entries) =>
      entries.filter((entry) => entry.relativePath !== relativePath)
    );
  }

  private mutate(scope: Scope, update: (entries: StoredEntry[]) => StoredEntry[]): Promise<void> {
    const task = this.writes.then(async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const { sub_key, stored, entries } = await this.read(scope);
        const next = update(entries);
        if (next.length > 1000) {
          throw new OnlyPreviewContractError(
            'OPERATION_FAILED',
            'The Project bookmark limit was reached.'
          );
        }
        if (JSON.stringify(next) === JSON.stringify(entries)) return;
        this.requireCurrent(scope);
        const value = { version: 1, entries: next };
        const written =
          stored.exists && stored.serializedValue !== null
            ? await this.storage!.compareAndSet({
                key: STORAGE_KEY,
                sub_key,
                expectedSerializedValue: stored.serializedValue,
                value
              })
            : await this.storage!.insertIfAbsent({ key: STORAGE_KEY, sub_key, value });
        if (!written) continue;
        this.requireCurrent(scope);
        this.changed(scope.host.hostId, scope.workspaceId);
        return;
      }
      throw new OnlyPreviewContractError('OPERATION_FAILED', 'Bookmarks changed concurrently.');
    });
    this.writes = task.catch(() => undefined);
    return task;
  }
}
