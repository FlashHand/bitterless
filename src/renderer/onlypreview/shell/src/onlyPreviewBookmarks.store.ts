import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';
import {
  ONLY_PREVIEW_BOOKMARK_ADD_EVENT,
  ONLY_PREVIEW_BOOKMARKS_CHANGED_EVENT
} from '@shared/onlypreview/onlyPreviewBookmarks.type';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import { onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import type { OnlyPreviewBookmark, OnlyPreviewBookmarksSnapshot } from '@shared/onlypreview/onlyPreviewBookmarks.type';
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
  private workspaceGeneration = 0;
  private revision = -1;
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
    this.workspaceGeneration += 1;
    this.revision = -1;
    void this.refresh();
  }
  async refresh(): Promise<void> {
    const { hostToken } = this.host;
    const workspaceId = this.host.workspaceId();
    const generation = ++this.generation;
    const revision = this.revision;
    if (!this.active || !hostToken || !workspaceId) return;
    try {
      const snapshot = unwrapOnlyPreviewResult(
        await this.client.getBookmarks({ hostToken, workspaceId })
      );
      if (!this.active || generation !== this.generation || workspaceId !== this.host.workspaceId())
        return;
      if (snapshot.workspaceId !== workspaceId) return;
      this.apply(snapshot);
      this.errorMessage = '';
    } catch (error) {
      if (
        this.active &&
        generation === this.generation && revision === this.revision &&
        workspaceId === this.host.workspaceId()
      ) {
        this.errorMessage = describeOnlyPreviewError(error);
      }
    }
  }
  async add(relativePath: string): Promise<void> {
    if (relativePath) await this.runAction('addBookmark', relativePath);
  }
  async remove(relativePath: string): Promise<void> {
    if (relativePath) await this.runAction('removeBookmark', relativePath);
  }
  async showMenu(relativePath: string): Promise<void> {
    if (this.entries.some((entry) => entry.relativePath === relativePath)) {
      await this.runAction('showBookmarkContextMenu', relativePath);
    }
  }
  /**
   * 弹一条纯提示,告诉用户怎么加书签。
   *
   * 复用 alert 面(`showNotice` → main 的 `showError(tone:'notice')`),所以
   * 「回车 / esc / 点关闭都能关」与焦点管理都是那一层既有的行为 —— 这里不新写任何键盘处理。
   * 文案从本渲染进程的 i18n 取:提示语属于这个界面,不属于 main。
   *
   * 失败**静默**:一条帮助提示弹不出来,不该在书签条上留一条错误 —— 那比没有提示更糟。
   */
  async showHint(): Promise<void> {
    const { hostToken } = this.host;
    if (!this.active || !hostToken) return;
    try {
      unwrapOnlyPreviewResult(
        await onlyPreviewClient.showNotice({
          hostToken,
          title: onlyPreviewI18n.bookmarks.hintTitle,
          message: onlyPreviewI18n.bookmarks.hintMessage,
          confirmLabel: onlyPreviewI18n.bookmarks.hintClose
        })
      );
    } catch {
      // 见上:提示失败不留痕。
    }
  }
  receive(event: unknown, add = false): void {
    if (!this.active || !event || typeof event !== 'object') return;
    const params = event as OnlyPreviewBookmarksSnapshot & { hostId?: unknown; relativePath?: unknown };
    if (params.hostId !== this.host.hostId || params.workspaceId !== this.host.workspaceId())
      return;
    if (add) {
      if (typeof params.relativePath === 'string') void this.add(params.relativePath);
    } else {
      this.apply(params);
    }
  }
  private apply(snapshot: OnlyPreviewBookmarksSnapshot): void {
    if (snapshot.workspaceId !== this.host.workspaceId() || !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision <= this.revision || !Array.isArray(snapshot.entries)) return;
    this.entries = snapshot.entries;
    this.revision = snapshot.revision;
    this.errorMessage = '';
  }
  private async runAction(
    action: 'addBookmark' | 'removeBookmark' | 'showBookmarkContextMenu',
    relativePath: string
  ): Promise<void> {
    const { hostToken } = this.host;
    const workspaceId = this.host.workspaceId();
    if (!this.active || !hostToken || !workspaceId) return;
    const generation = ++this.actionGeneration;
    const workspaceGeneration = this.workspaceGeneration;
    this.errorMessage = '';
    try {
      const snapshot = unwrapOnlyPreviewResult(await this.client[action]({ hostToken, workspaceId, relativePath }));
      if (
        this.active &&
        workspaceGeneration === this.workspaceGeneration &&
        workspaceId === this.host.workspaceId()
      ) {
        if (snapshot) this.apply(snapshot);
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
