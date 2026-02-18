import { reactive } from 'vue';
import type { DatabaseSetting } from './setting.store.type';
import { settingEmitter } from '@/emitter/setting.emitter';

const SETTING_KEY_DATABASE = 'database';

class SettingStore {
  databaseSetting: DatabaseSetting = {
    sqlitePassword: '',
    qdrantApiKey: '',
  };
  loading = false;
  saveStatus: 'idle' | 'success' | 'failed' = 'idle';
}

export const settingStore = reactive<SettingStore>(new SettingStore());

export const loadDatabaseSetting = async (): Promise<void> => {
  settingStore.loading = true;
  try {
    const result = await settingEmitter.get({ key: SETTING_KEY_DATABASE });
    if (result) {
      const data = result as DatabaseSetting;
      settingStore.databaseSetting.sqlitePassword = data.sqlitePassword || '';
      settingStore.databaseSetting.qdrantApiKey = data.qdrantApiKey || '';
    }
  } catch (err: any) {
    console.error('[settingStore] loadDatabaseSetting failed:', err.message);
  } finally {
    settingStore.loading = false;
  }
};

export const saveDatabaseSetting = async (): Promise<void> => {
  settingStore.saveStatus = 'idle';
  try {
    await settingEmitter.upsert({
      key: SETTING_KEY_DATABASE,
      value: {
        sqlitePassword: settingStore.databaseSetting.sqlitePassword,
        qdrantApiKey: settingStore.databaseSetting.qdrantApiKey,
      },
    });
    settingStore.saveStatus = 'success';
    setTimeout(() => {
      settingStore.saveStatus = 'idle';
    }, 2000);
  } catch (err: any) {
    console.error('[settingStore] saveDatabaseSetting failed:', err.message);
    settingStore.saveStatus = 'failed';
  }
};
