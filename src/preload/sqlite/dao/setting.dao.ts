import { BaseDao } from './base.dao';
import { sqliteHelper, sanitizeValue } from '../sqliteHelper/sqlite.helper';

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

class SettingDao extends BaseDao {
  /** Get a setting value by key. Returns parsed JSON or null if not found. */
  get<T = any>(params: { key: string }): T | null {
    const row = sqliteHelper.safeGet<SettingRow>(
      'SELECT key, value FROM setting WHERE key = ?',
      [params.key],
    );
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  /** Upsert LLM config. Shorthand for upsert with key='LLM'. */
  upsertLLMConfig(params: { value: any }): string {
    return this.upsert({ key: 'LLM', value: params.value });
  }

  /** Upsert a setting. Value will be JSON-serialized. */
  upsert(params: { key: string; value: any }): string {
    const jsonValue = sanitizeValue(JSON.stringify(params.value));
    sqliteHelper.safeRun(
      `INSERT INTO setting (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [params.key, jsonValue],
    );
    return 'ok';
  }
}

export const settingDao = new SettingDao();
