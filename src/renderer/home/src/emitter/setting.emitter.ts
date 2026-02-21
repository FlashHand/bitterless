import { createXpcRendererEmitter } from 'electron-xpc/renderer';

interface SettingDaoType {
  get: (params: { key: string }) => Promise<any>;
  upsert: (params: { key: string; value: any }) => Promise<string>;
}

export const settingEmitter = createXpcRendererEmitter<SettingDaoType>('SettingDao');
