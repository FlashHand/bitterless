import { BaseTable } from './base.table';

class KeychainTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS keychain (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL UNIQUE,
      key TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `;
}

export const keychainTable = new KeychainTable();
