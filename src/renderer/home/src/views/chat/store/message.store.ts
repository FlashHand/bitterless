import { reactive } from 'vue';
import dayjs from 'dayjs';
import type { ChatMessage } from './message.store.type';
import { xpcRenderer } from 'electron-buff/xpc/renderer';

let idCounter = 0;
const generateId = (): string => `msg_${Date.now()}_${++idCounter}`;

class MessageStore {
  messageList: ChatMessage[] = [];
  streamingContent = '';
  isStreaming = false;
  currentConversationId = `conv_${Date.now()}`;
}

export const messageStore = reactive<MessageStore>(new MessageStore());

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
      messageStore.messageList.push({
        id: generateId(),
        conversationId: messageStore.currentConversationId,
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

  messageStore.messageList.push({
    id: generateId(),
    conversationId: messageStore.currentConversationId,
    role: 'user',
    content: content.trim(),
    createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
  });

  messageStore.isStreaming = true;
  messageStore.streamingContent = '';

  await xpcRenderer.send('chat/send', {
    conversationId: messageStore.currentConversationId,
    content: content.trim(),
  });
};
