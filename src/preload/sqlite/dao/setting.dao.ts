import { BaseDao } from './base.dao';
import { safeGet, safeRun, sanitizeValue } from '../sqliteHelper/sqlite.helper';

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

class SettingDao extends BaseDao {
  /** Get a setting value by key. Returns parsed JSON or null if not found. */
  get<T = any>(key: string): T | null {
    const row = safeGet<SettingRow>(
      this.db,
      'SELECT key, value FROM setting WHERE key = ?',
      [key],
    );
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  /** Upsert a setting. Value will be JSON-serialized. */
  upsert(key: string, value: any): void {
    const jsonValue = sanitizeValue(JSON.stringify(value));
    safeRun(
      this.db,
      `INSERT INTO setting (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, jsonValue],
    );
  }
}

export const settingDao = new SettingDao();
