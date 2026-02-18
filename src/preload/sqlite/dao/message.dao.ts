import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';

interface MessageRow {
  id: number;
  conversation_id: string;
  role: string;
  content: string;
  platform: string;
  created_at: string;
}

export interface MessageInsertParams {
  conversationId: string;
  role: string;
  content: string;
  platform?: string;
}

class MessageDao extends BaseDao {
  /** Insert a message and return the new row ID */
  insert(params: MessageInsertParams): number {
    const { conversationId, role, content, platform = 'bitterless' } = params;
    const result = sqliteHelper.safeRun(
      'INSERT INTO message (conversation_id, role, content, platform) VALUES (?, ?, ?, ?)',
      [conversationId, role, content, platform],
    );
    return Number(result.lastInsertRowid);
  }

  /** Get message history for a conversation, ordered by id ASC */
  getHistoryByConversationId(params: { conversationId: string }): Pick<MessageRow, 'role' | 'content'>[] {
    return sqliteHelper.safeAll<Pick<MessageRow, 'role' | 'content'>>(
      'SELECT role, content FROM message WHERE conversation_id = ? ORDER BY id ASC',
      [params.conversationId],
    );
  }
}

export const messageDao = new MessageDao();
