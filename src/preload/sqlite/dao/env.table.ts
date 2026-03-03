import { BaseTable } from './base.table';

class EnvTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS env (
      key TEXT PRIMARY KEY,
      values TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );
  `;
}

export const envTable = new EnvTable();
