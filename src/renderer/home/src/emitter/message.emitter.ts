import { createXpcRendererEmitter } from 'electron-buff/xpc/renderer';

interface MessageInsertParams {
  conversationId: string;
  role: string;
  content: string;
  platform?: string;
}

interface MessageHistoryParams {
  conversationId: string;
}

interface MessageHistoryRow {
  role: string;
  content: string;
}

interface MessageDaoType {
  insert: (params: MessageInsertParams) => Promise<number>;
  getHistoryByConversationId: (params: MessageHistoryParams) => Promise<MessageHistoryRow[]>;
}

export const messageEmitter = createXpcRendererEmitter<MessageDaoType>('MessageDao');
