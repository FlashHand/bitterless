import { reactive } from 'vue';
import { Message } from '@arco-design/web-vue';
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import {
  ZELLIJ_HANDLER_NAME,
  ZELLIJ_STATE_EVENT,
  ZELLIJ_SURFACE_QUERY,
  type ZellijApi,
  type ZellijErrorCode,
  type ZellijSnapshot
} from '@shared/zellij/zellij.type';

const api = createXpcRendererEmitter<ZellijApi>(ZELLIJ_HANDLER_NAME);

/**
 * Which surface this chrome belongs to, put on the URL by `ZellijSurface.load()`.
 *
 * Read once at module load: it is fixed for the life of the page, and every terminal geometry
 * message has to carry it or main cannot tell these interchangeable renderers apart.
 */
const SURFACE_ID = new URLSearchParams(window.location.search).get(ZELLIJ_SURFACE_QUERY) ?? '';

/**
 * Every catch here used to be a bare `catch {` that collapsed the real cause into the generic
 * 'operation-failed' code — so a failure showed one translated sentence and left no way to find out
 * what actually broke. The renderer console is captured into the application log file
 * (see src/main/logging/logPolicy.service.ts), so this reaches the log without DevTools open.
 */
const logZellijFailure = (code: string, error: unknown): void => {
  console.error(`[zellij] ${code}`, error);
};

class ZellijState {
  snapshot: ZellijSnapshot | null = null;
  settingsOpen = false;
  loading = false;
  initializing = false;
  saving = false;
  toggling = false;
  error: ZellijErrorCode | null = null;
  draft = { splitDown: '', splitRight: '', closePane: '' };
  revision = '';

  get errorMessage(): string | null {
    const error = this.error ?? this.snapshot?.error;
    return error ? i18nHelper.zellij.errors[error] : null;
  }

  get statusLabel(): string {
    if (!this.snapshot?.enabled) return i18nHelper.zellij.status.off;
    return i18nHelper.zellij.status[this.snapshot.status];
  }

  apply(snapshot: ZellijSnapshot | null, resetDraft = false): void {
    if (!snapshot || typeof snapshot.enabled !== 'boolean' || !snapshot.shortcuts) {
      // A malformed snapshot looks identical to a thrown call from the UI, so say which one it was.
      logZellijFailure('operation-failed', new Error(`malformed snapshot: ${JSON.stringify(snapshot)}`));
      this.error = 'operation-failed';
      return;
    }
    this.snapshot = snapshot;
    if (!this.settingsOpen || resetDraft) {
      this.draft = { ...snapshot.shortcuts };
      this.revision = snapshot.configRevision;
    }
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.apply(await api.snapshot(), true);
    } catch (error) {
      logZellijFailure('operation-failed', error);
      this.error = 'operation-failed';
    } finally {
      this.loading = false;
    }
  }

  async initialize(): Promise<void> {
    if (this.initializing || !this.snapshot?.enabled) return;
    this.initializing = true;
    this.error = null;
    try {
      this.apply(await api.initialize());
    } catch (error) {
      logZellijFailure('operation-failed', error);
      this.error = 'operation-failed';
    } finally {
      this.initializing = false;
    }
  }

  async setEnabled(value: string | number | boolean): Promise<void> {
    if (this.toggling) return;
    this.toggling = true;
    this.error = null;
    try {
      this.apply(await api.setEnabled({ enabled: value === true }));
    } catch (error) {
      logZellijFailure('operation-failed', error);
      this.error = 'operation-failed';
    } finally {
      this.toggling = false;
    }
  }

  async toggleSettings(): Promise<void> {
    this.settingsOpen = !this.settingsOpen;
    if (this.settingsOpen) await this.load();
  }

  async save(): Promise<void> {
    if (this.saving || this.loading) return;
    this.saving = true;
    this.error = null;
    try {
      const next = await api.saveShortcuts({
        revision: this.revision,
        shortcuts: { ...this.draft }
      });
      this.apply(next, !next?.error);
      if (next && !next.error) Message.success(i18nHelper.zellij.saved);
    } catch (error) {
      logZellijFailure('operation-failed', error);
      this.error = 'operation-failed';
    } finally {
      this.saving = false;
    }
  }

  async copyDirectory(): Promise<void> {
    try {
      const result = await api.copyConfigDirectory();
      if (!result?.ok) this.error = result?.error ?? 'operation-failed';
      else Message.success(i18nHelper.zellij.copied);
    } catch (error) {
      logZellijFailure('operation-failed', error);
      this.error = 'operation-failed';
    }
  }

  async openDirectory(): Promise<void> {
    try {
      const result = await api.openConfigDirectory();
      if (!result?.ok) this.error = result?.error ?? 'directory-open-failed';
    } catch (error) {
      logZellijFailure('directory-open-failed', error);
      this.error = 'directory-open-failed';
    }
  }

  async setBounds(element: HTMLElement): Promise<void> {
    const rect = element.getBoundingClientRect();
    await api.setContentBounds({
      surfaceId: SURFACE_ID,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    });
  }
}

export const zellijStore = reactive<ZellijState>(new ZellijState());
xpcRenderer.subscribe(ZELLIJ_STATE_EVENT, (payload) => {
  zellijStore.apply(payload.params as ZellijSnapshot);
});
