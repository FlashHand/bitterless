import { injectable } from 'inversify';
import { CommonService } from '../../../../../../shared/iocHelper/ioc.helper';
import type { MessageController } from './message.store';
import type { ChatMessage } from './messageStore.type';
import dayjs from 'dayjs';
import { xpcRenderer } from 'electron-xpc/renderer';

let idCounter = 0;
const generateId = (): string => `msg_${Date.now()}_${++idCounter}`;

@injectable()
export class MessageListService extends CommonService<MessageController> {
  /** Load message history from DB for the current session */
  async loadHistory(): Promise<void> {
    const sessionId = this._state.currentSessionId;
    if (!sessionId) {
      this._state.showedMessageList = [];
      return;
    }
    const result = await xpcRenderer.send('MessageDao/getHistoryBySessionId', { sessionId });
    if (Array.isArray(result)) {
      this._state.showedMessageList = result.map((row: { role: string; content: string }) => ({
        id: generateId(),
        sessionId,
        role: row.role as ChatMessage['role'],
        content: row.content,
        createdAt: '',
      }));
    }
  }

  /** Add a user message to the list */
  addUserMessage(content: string): void {
    this._state.showedMessageList.push({
      id: generateId(),
      sessionId: this._state.currentSessionId,
      role: 'user',
      content,
      createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    });
  }

  /** Add an assistant message to the list */
  addAssistantMessage(content: string): void {
    this._state.showedMessageList.push({
      id: generateId(),
      sessionId: this._state.currentSessionId,
      role: 'assistant',
      content,
      createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    });
  }

  /** Clear the displayed message list */
  clear(): void {
    this._state.showedMessageList = [];
  }
}
