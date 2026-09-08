import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  ONLY_PREVIEW_BOOKMARK_ADD_EVENT,
  ONLY_PREVIEW_BOOKMARKS_CHANGED_EVENT
} from '@shared/onlypreview/onlyPreviewBookmarks.type';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewBookmark } from '@shared/onlypreview/onlyPreviewBookmarks.type';
import type {
  OnlyPreviewBookmarksClient,
  OnlyPreviewBookmarksHost
} from './onlyPreviewBookmarks.type';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { describeOnlyPreviewError } from './onlyPreviewErrorDetail.store';
import { onlyPreviewShellStore } from './onlyPreviewShell.store';

export class OnlyPreviewBookmarksStore {
  entries: OnlyPreviewBookmark[] = [];
  errorMessage = '';
  private generation = 0;
  private actionGeneration = 0;
  private active = false;
  private subscribed = false;
  constructor(
    private readonly client: OnlyPreviewBookmarksClient,
    private readonly host: OnlyPreviewBookmarksHost
  ) {}

  initialize(): void {
    this.active = true;
    if (!this.subscribed) {
      this.subscribed = true;
      xpcRenderer.subscribe(ONLY_PREVIEW_BOOKMARK_ADD_EVENT, ({ params }) =>
        this.receive(params, true)
      );
      xpcRenderer.subscribe(ONLY_PREVIEW_BOOKMARKS_CHANGED_EVENT, ({ params }) =>
        this.receive(params)
      );
    }
    this.resetWorkspace();
  }
  dispose(): void {
    this.active = false;
    this.generation += 1;
    this.actionGeneration += 1;
  }
  resetWorkspace(): void {
    this.entries = [];
    this.errorMessage = '';
    this.generation += 1;
    this.actionGeneration += 1;
    void this.refresh();
  }
  async refresh(): Promise<void> {
    const { hostToken } = this.host;
    const workspaceId = this.host.workspaceId();
    const generation = ++this.generation;
    if (!this.active || !hostToken || !workspaceId) return;
    try {
      const snapshot = unwrapOnlyPreviewResult(
        await this.client.getBookmarks({ hostToken, workspaceId })
      );
      if (!this.active || generation !== this.generation || workspaceId !== this.host.workspaceId())
        return;
      if (snapshot.workspaceId !== workspaceId) return;
      this.entries = snapshot.entries;
      this.errorMessage = '';
    } catch (error) {
      if (
        this.active &&
        generation === this.generation &&
        workspaceId === this.host.workspaceId()
      ) {
        this.errorMessage = describeOnlyPreviewError(error);
      }
    }
  }
  async add(relativePath: string): Promise<void> {
    if (relativePath) await this.runAction('addBookmark', relativePath);
  }
  async showMenu(relativePath: string): Promise<void> {
    if (this.entries.some((entry) => entry.relativePath === relativePath)) {
      await this.runAction('showBookmarkContextMenu', relativePath);
    }
  }
  receive(event: unknown, add = false): void {
    if (!this.active || !event || typeof event !== 'object') return;
    const params = event as { hostId?: unknown; workspaceId?: unknown; relativePath?: unknown };
    if (params.hostId !== this.host.hostId || params.workspaceId !== this.host.workspaceId())
      return;
    if (add) {
      if (typeof params.relativePath === 'string') void this.add(params.relativePath);
    } else {
      void this.refresh();
    }
  }
  private async runAction(
    action: 'addBookmark' | 'showBookmarkContextMenu',
    relativePath: string
  ): Promise<void> {
    const { hostToken } = this.host;
    const workspaceId = this.host.workspaceId();
    if (!this.active || !hostToken || !workspaceId) return;
    const generation = ++this.actionGeneration;
    this.errorMessage = '';
    try {
      unwrapOnlyPreviewResult(await this.client[action]({ hostToken, workspaceId, relativePath }));
      if (
        this.active &&
        generation === this.actionGeneration &&
        workspaceId === this.host.workspaceId()
      ) {
        await this.refresh();
      }
    } catch (error) {
      if (
        this.active &&
        generation === this.actionGeneration &&
        workspaceId === this.host.workspaceId()
      ) {
        this.errorMessage = describeOnlyPreviewError(error);
      }
    }
  }
}
export const onlyPreviewBookmarksStore = reactive(
  new OnlyPreviewBookmarksStore(onlyPreviewClient, {
    hostToken: onlyPreviewEnv.hostToken,
    hostId: onlyPreviewEnv.hostId,
    workspaceId: () => onlyPreviewShellStore.workspace?.workspaceId ?? null
  })
);
