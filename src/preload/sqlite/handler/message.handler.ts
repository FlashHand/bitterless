import { XpcPreloadHandler } from 'electron-buff/xpc/preload';
import { messageDao } from '../dao/message.dao';

interface InsertParams {
  conversationId: string;
  role: string;
  content: string;
  platform?: string;
}

interface HistoryParams {
  conversationId: string;
}

export class MessageHandler extends XpcPreloadHandler {
  async insert(params: InsertParams): Promise<number> {
    return messageDao.insert(params);
  }

  async getHistoryByConversationId(params: HistoryParams): Promise<{ role: string; content: string }[]> {
    return messageDao.getHistoryByConversationId(params.conversationId);
  }
}
