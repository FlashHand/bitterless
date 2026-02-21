import { createXpcRendererEmitter } from 'electron-xpc/renderer';

interface MessageInsertParams {
  sessionId: string;
  role: string;
  content: string;
  platform?: string;
}

interface MessageHistoryParams {
  sessionId: string;
}

interface MessageHistoryRow {
  role: string;
  content: string;
}

interface MessageDaoType {
  insert: (params: MessageInsertParams) => Promise<number>;
  getHistoryBySessionId: (params: MessageHistoryParams) => Promise<MessageHistoryRow[]>;
}

export const messageEmitter = createXpcRendererEmitter<MessageDaoType>('MessageDao');
