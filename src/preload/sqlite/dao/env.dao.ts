import { BaseDao } from './base.dao';
import { sqliteHelper, sanitizeValue } from '../sqliteHelper/sqlite.helper';

interface EnvRow {
  key: string;
  values: string;
  updated_at: number;
}

class EnvDao extends BaseDao {
  async get(params: { key: string }): Promise<Record<string, string> | null> {
    const row = await sqliteHelper.safeGet<EnvRow>(
      'SELECT key, values FROM env WHERE key = ?',
      [params.key],
    );
    if (!row) return null;
    try {
      return JSON.parse(row.values) as Record<string, string>;
    } catch {
      return null;
    }
  }

  async upsert(params: { key: string; values: Record<string, string> }): Promise<string> {
    const jsonValues = sanitizeValue(JSON.stringify(params.values));
    const now = Date.now();
    await sqliteHelper.safeRun(
      `INSERT INTO env (key, values, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET values = excluded.values, updated_at = excluded.updated_at`,
      [params.key, jsonValues, now],
    );
    return 'ok';
  }

  async delete(params: { key: string }): Promise<string> {
    await sqliteHelper.safeRun('DELETE FROM env WHERE key = ?', [params.key]);
    return 'ok';
  }
}

export const envDao = new EnvDao();
