import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';

interface MessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  platform: string;
  created_at: string;
}

export interface MessageInsertParams {
  sessionId: string;
  role: string;
  content: string;
  platform?: string;
}

class MessageDao extends BaseDao {
  /** Insert a new message, returns the new row id */
  insert(params: MessageInsertParams): number {
    const result = sqliteHelper.safeRun(
      'INSERT INTO message (session_id, role, content, platform) VALUES (?, ?, ?, ?)',
      [params.sessionId, params.role, params.content, params.platform ?? 'bitterless'],
    );
    return result?.lastInsertRowid as number ?? 0;
  }

  /** Get message history for a conversation, ordered by id ASC */
  getHistoryBySessionId(params: { sessionId: string }): Pick<MessageRow, 'role' | 'content'>[] {
    return sqliteHelper.safeAll<Pick<MessageRow, 'role' | 'content'>>(
      'SELECT role, content FROM message WHERE session_id = ? ORDER BY id ASC',
      [params.sessionId],
    );
  }
}

export const messageDao = new MessageDao();
