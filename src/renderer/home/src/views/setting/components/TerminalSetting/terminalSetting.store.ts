import { reactive } from 'vue';
import { Message } from '@arco-design/web-vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { CoachXpcContract } from '@maestro-shared/coach.api';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

const coach =
  createXpcRendererEmitter<Pick<CoachXpcContract, 'getSettings' | 'saveSettings'>>(
    'CoachXpcHandler'
  );

class TerminalSettingState {
  enabled = false;
  ready = false;
  loading = false;
  saving = false;

  async load(): Promise<void> {
    if (this.loading || this.saving) return;
    this.ready = false;
    this.loading = true;
    try {
      this.enabled = (await coach.getSettings()).terminalEnabled;
      this.ready = true;
    } catch (error) {
      Message.error(i18nHelper.setting.terminal.loadFailed);
      console.error('[TerminalSettingState] Failed to load terminal setting:', error);
    } finally {
      this.loading = false;
    }
  }

  async change(value: string | number | boolean): Promise<void> {
    const enabled = value === true;
    if (!this.ready || this.loading || this.saving || enabled === this.enabled) return;
    this.saving = true;
    try {
      this.enabled = (await coach.saveSettings({ terminalEnabled: enabled })).terminalEnabled;
    } catch (error) {
      Message.error(i18nHelper.setting.terminal.saveFailed);
      console.error('[TerminalSettingState] Failed to save terminal setting:', error);
    } finally {
      this.saving = false;
    }
  }
}

export const terminalSettingStore = reactive<TerminalSettingState>(new TerminalSettingState());
