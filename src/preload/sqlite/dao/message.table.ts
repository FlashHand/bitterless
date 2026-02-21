import { BaseTable } from './base.table';

class MessageTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'bitterless',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_message_session ON message(session_id);
  `;
}

export const messageTable = new MessageTable();
