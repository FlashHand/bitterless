import { BaseTable } from './base.table';

class SettingTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS setting (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
  `;
}

export const settingTable = new SettingTable();
