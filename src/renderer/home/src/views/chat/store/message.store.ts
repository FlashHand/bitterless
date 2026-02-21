import 'reflect-metadata';
import { reactive } from 'vue';
import dayjs from 'dayjs';
import { injectable, inject } from 'inversify';
import type { ChatMessage } from './messageStore.type';
import { xpcRenderer } from 'electron-xpc/renderer';
import { iocHelper } from '../../../../../../shared/iocHelper/ioc.helper';
import { MessageListService } from './messageList.service';
import { createSession, sessionStore } from './session.store';

let idCounter = 0;
const generateId = (): string => `msg_${Date.now()}_${++idCounter}`;

@injectable()
export class MessageController {
  showedMessageList: ChatMessage[] = [];
  streamingContent = '';
  isStreaming = false;
  currentTitle = '';

  constructor(
    @inject(Symbol.for(MessageListService.name))
    public readonly messageListService: MessageListService,
  ) {
    this.messageListService.setState(this);
  }
}

const state = iocHelper.bind({
  controller: MessageController,
  services: [MessageListService],
});

export const messageStore = reactive<MessageController>(state);

export const initMessageListeners = (): void => {
  xpcRenderer.handle('chat/stream/chunk', async (payload) => {
    const { chunk } = payload.params || {};
    if (chunk) {
      messageStore.streamingContent += chunk;
    }
    return 'ok';
  });

  xpcRenderer.handle('chat/stream/done', async (payload) => {
    const { content } = payload.params || {};
    if (content) {
      messageStore.showedMessageList.push({
        id: generateId(),
        sessionId: sessionStore.currentSessionId,
        role: 'assistant',
        content,
        createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      });
    }
    messageStore.streamingContent = '';
    messageStore.isStreaming = false;
    return 'ok';
  });

  console.log('[messageStore] listeners initialized');
};

export const sendMessage = async (content: string): Promise<void> => {
  if (!content.trim()) return;

  // Auto-create session if showedMessageList is empty (first message)
  if (messageStore.showedMessageList.length === 0) {
    await createSession();
  }

  messageStore.showedMessageList.push({
    id: generateId(),
    sessionId: sessionStore.currentSessionId,
    role: 'user',
    content: content.trim(),
    createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
  });

  messageStore.isStreaming = true;
  messageStore.streamingContent = '';

  await xpcRenderer.send('chat/send', {
    sessionId: sessionStore.currentSessionId,
    content: content.trim(),
  });
};
