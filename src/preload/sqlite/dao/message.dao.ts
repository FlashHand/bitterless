import { BaseDao } from './base.dao';

interface MessageRow {
  id: number;
  conversation_id: string;
  role: string;
  content: string;
  platform: string;
  created_at: string;
}

class MessageDao extends BaseDao {
  /** Insert a message and return the new row ID */
  insert(conversationId: string, role: string, content: string, platform = 'bitterless'): number {
    const stmt = this.db.prepare(
      'INSERT INTO message (conversation_id, role, content, platform) VALUES (?, ?, ?, ?)',
    );
    const result = stmt.run(conversationId, role, content, platform);
    return Number(result.lastInsertRowid);
  }

  /** Get message history for a conversation, ordered by id ASC */
  getHistoryByConversationId(conversationId: string): Pick<MessageRow, 'role' | 'content'>[] {
    return this.db
      .prepare('SELECT role, content FROM message WHERE conversation_id = ? ORDER BY id ASC')
      .all(conversationId) as Pick<MessageRow, 'role' | 'content'>[];
  }
}

export const messageDao = new MessageDao();
