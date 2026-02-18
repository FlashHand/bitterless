import { createXpcRendererEmitter } from 'electron-buff/xpc/renderer';

interface KeychainRow {
  id: number;
  platform: string;
  key: string;
  updated_at: string;
}

interface KeychainDaoType {
  get: (params: { platform: string }) => Promise<any>;
  upsert: (params: { platform: string; key: any }) => Promise<string>;
  remove: (params: { platform: string }) => Promise<string>;
  list: () => Promise<KeychainRow[]>;
}

export const keychainEmitter = createXpcRendererEmitter<KeychainDaoType>('KeychainDao');
