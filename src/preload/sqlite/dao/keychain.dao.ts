import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';

interface KeychainRow {
  id: number;
  platform: string;
  key: string;
  updated_at: string;
}

class KeychainDao extends BaseDao {
  /** Get key by platform. Returns parsed JSON or null if not found. */
  get<T = any>(params: { platform: string }): T | null {
    const row = sqliteHelper.safeGet<KeychainRow>(
      'SELECT key FROM keychain WHERE platform = ?',
      [params.platform],
    );
    if (!row || !row.key) return null;
    try {
      return JSON.parse(row.key) as T;
    } catch {
      return null;
    }
  }

  /** Upsert a key for a platform. Value will be JSON-serialized. */
  upsert(params: { platform: string; key: any }): string {
    const jsonKey = JSON.stringify(params.key);
    sqliteHelper.safeRun(
      `INSERT INTO keychain (platform, key, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(platform) DO UPDATE SET key = excluded.key, updated_at = excluded.updated_at`,
      [params.platform, jsonKey],
    );
    return 'ok';
  }

  /** Delete a key by platform. */
  remove(params: { platform: string }): string {
    sqliteHelper.safeRun(
      'DELETE FROM keychain WHERE platform = ?',
      [params.platform],
    );
    return 'ok';
  }

  /** List all keychain entries. */
  list(): KeychainRow[] {
    return sqliteHelper.safeAll<KeychainRow>(
      'SELECT id, platform, key, updated_at FROM keychain ORDER BY id ASC',
    );
  }
}

export const keychainDao = new KeychainDao();
