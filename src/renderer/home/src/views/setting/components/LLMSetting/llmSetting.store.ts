import { reactive } from 'vue';
import type { LLMSetting } from '../../store/setting.store.type';
import { settingEmitter } from '@/emitter/setting.emitter';

const SETTING_KEY_LLM = 'LLM';

class LLMSettingStore {
  llmSetting: LLMSetting = {
    provider: '',
    model: '',
    apiKey: '',
    endpoint: '',
  };
  loading = false;
  saveStatus: 'idle' | 'success' | 'failed' = 'idle';
}

export const llmSettingStore = reactive<LLMSettingStore>(new LLMSettingStore());

export const loadLLMSetting = async (): Promise<void> => {
  llmSettingStore.loading = true;
  try {
    const result = await settingEmitter.get({ key: SETTING_KEY_LLM });
    if (result) {
      const data = result as any;
      llmSettingStore.llmSetting.provider = data.provider || '';
      llmSettingStore.llmSetting.model = data.model || '';
      llmSettingStore.llmSetting.apiKey = data.apiKey || '';
      llmSettingStore.llmSetting.endpoint = data.baseURL || data.endpoint || '';
    }
  } catch (err: any) {
    console.error('[llmSettingStore] loadLLMSetting failed:', err.message);
  } finally {
    llmSettingStore.loading = false;
  }
};

export const saveLLMSetting = async (): Promise<void> => {
  llmSettingStore.saveStatus = 'idle';
  try {
    await settingEmitter.upsert({
      key: SETTING_KEY_LLM,
      value: {
        provider: llmSettingStore.llmSetting.provider,
        model: llmSettingStore.llmSetting.model,
        apiKey: llmSettingStore.llmSetting.apiKey,
        baseURL: llmSettingStore.llmSetting.endpoint,
      },
    });
    llmSettingStore.saveStatus = 'success';
    setTimeout(() => {
      llmSettingStore.saveStatus = 'idle';
    }, 2000);
  } catch (err: any) {
    console.error('[llmSettingStore] saveLLMSetting failed:', err.message);
    llmSettingStore.saveStatus = 'failed';
  }
};
