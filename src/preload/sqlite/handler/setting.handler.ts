import { XpcPreloadHandler } from 'electron-buff/xpc/preload';
import { settingDao } from '../dao/setting.dao';

export class SettingHandler extends XpcPreloadHandler {
  async get(params: { key: string }): Promise<any> {
    return settingDao.get(params.key);
  }

  async upsert(params: { key: string; value: any }): Promise<string> {
    settingDao.upsert(params.key, params.value);
    return 'ok';
  }
}
