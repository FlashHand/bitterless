import { BaseDao } from './base.dao';
import { sqliteHelper, sanitizeValue } from '../sqliteHelper/sqlite.helper';

interface SettingRow {
  key: string;
  value: string;
  updated_at: number;
}

export class SettingDao extends BaseDao {
  /** Get a setting value by key. Returns parsed JSON or null if not found. */
  async get<T = any>(params: { key: string }): Promise<T | null> {
    console.log('getting value', params);
    const row = await sqliteHelper.safeGet<SettingRow>(
      'SELECT key, value FROM setting WHERE key = ?',
      [params.key],
    );
    console.log('row', row);
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  /** Upsert a setting. Value will be JSON-serialized. */
  async upsert(params: { key: string; value: any }): Promise<string> {
    console.log('upserting value', params);
    const jsonValue = sanitizeValue(JSON.stringify(params.value));
    const now = Date.now();
    await sqliteHelper.safeRun(
      `INSERT INTO setting (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [params.key, jsonValue, now],
    );
    return 'ok';
  }
}

export const settingDao = new SettingDao();
