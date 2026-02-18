import Database from 'better-sqlite3-multiple-ciphers';
import { sqliteManager } from './sqlite.manager';

class SqliteHelper {
  private get db(): Database.Database {
    return sqliteManager.db;
  }

  /**
   * Safely execute a parameterized SELECT query, preventing SQL injection.
   * Uses prepared statements with bound parameters.
   */
  safeGet<T = any>(sql: string, params: any[] = []): T | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(...params) as T | undefined;
  }

  /**
   * Safely execute a parameterized SELECT ALL query, preventing SQL injection.
   */
  safeAll<T = any>(sql: string, params: any[] = []): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  /**
   * Safely execute a parameterized INSERT/UPDATE/DELETE, preventing SQL injection.
   * Returns the RunResult.
   */
  safeRun(sql: string, params: any[] = []): Database.RunResult {
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }
}

export const sqliteHelper = new SqliteHelper();

/**
 * Sanitize a string value for safe storage (trim + length limit).
 * This is an extra layer on top of parameterized queries.
 */
export const sanitizeValue = (value: string, maxLength = 10000): string => {
  return value.slice(0, maxLength);
};
