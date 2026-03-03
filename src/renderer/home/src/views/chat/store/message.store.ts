import 'reflect-metadata';
import { reactive } from 'vue';
import moment from 'moment';
import { injectable, inject } from 'inversify';
import type { ChatMessage } from './messageStore.type';
import { xpcRenderer } from 'electron-xpc/renderer';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { iocHelper } from '@shared/iocHelper/ioc.helper';
import { messageEmitter } from '@/emitter/message.emitter';
import { MessageListService } from './messageList.service';
import { createSession, sessionStore } from './session.store';

let _messageListRef: HTMLElement | null = null;
let _messageInputFocus: (() => void) | null = null;

@injectable()
export class MessageController {
  showedMessageList: ChatMessage[] = [];
  streamingContent = '';
  isStreaming = false;
  isResponding = false;
  currentTitle = '';
  inputContent = '';
  placeholder = i18nHelper.chat.inputPlaceHolder;
  scrollStatus = {}

  setMessageListRef(el: HTMLElement | null): void {
    _messageListRef = el;
  }

  getMessageListRef(): HTMLElement | null {
    return _messageListRef;
  }

  setMessageInputFocus(fn: (() => void) | null): void {
    _messageInputFocus = fn;
  }

  focusMessageInput(): void {
    _messageInputFocus?.();
  }

  showPlaceholder(): void {
    this.placeholder = i18nHelper.chat.inputPlaceHolder;
  }

  hidePlaceholder(): void {
    this.placeholder = '';
  }

  async send(content: string): Promise<void> {
    if (!content.trim()) return;
    const trimmedContent = content.trim();
    this.inputContent = '';
    // If no current session persisted yet, create it now with title from first message
    if (!sessionStore.currentSessionId) {
      const firstLine = trimmedContent.split('\n')[0].trim();
      const title = firstLine.slice(0, 20);
      await createSession(title);
    }

    this.showedMessageList.push({
      id: `temp_${Date.now()}`,
      sessionId: sessionStore.currentSessionId,
      role: 'user',
      content: trimmedContent,
      createdAt: moment().format('YYYY-MM-DD HH:mm:ss'),
    });
    this.messageListService.scrollToBottom();

    this.isStreaming = true;
    this.isResponding = true;
    this.streamingContent = '';
    await xpcRenderer.send('chat/send', {
      sessionId: sessionStore.currentSessionId,
      content: trimmedContent,
    });
  }
  async stopResponse(): Promise<void> {
    await xpcRenderer.send('chat/stop', {
      sessionId: sessionStore.currentSessionId,
    });
  }

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
    const { sessionId } = payload.params || {};
    messageStore.streamingContent = '';
    messageStore.isStreaming = false;
    messageStore.isResponding = false;
    const targetSessionId = sessionId || sessionStore.currentSessionId;
    if (!targetSessionId) return 'ok';
    if (messageStore.messageListService.isBrowsingHistory) {
      messageStore.messageListService.hasNew = true;
    } else {
      await messageStore.messageListService.loadPage(targetSessionId);
    }
    messageStore.focusMessageInput();
    return 'ok';
  });

  console.log('[messageStore] listeners initialized');
};

export const recallMessage = async (msgIndex: number): Promise<void> => {
  const msg = messageStore.showedMessageList[msgIndex];
  if (!msg || msg.role !== 'user') return;

  // Fill input with recalled content
  messageStore.inputContent = msg.content;

  // Remove from store from this index onwards
  messageStore.showedMessageList = messageStore.showedMessageList.slice(0, msgIndex);

  // Delete from sqlite
  if (sessionStore.currentSessionId) {
    await messageEmitter.deleteFromIndex({
      sessionId: sessionStore.currentSessionId,
      fromIndex: msgIndex,
    });

    // Check if session has no remaining messages
    if (msgIndex === 0) {
      // No messages left, delete the session
      const { deleteSession } = await import('./session.store');
      await deleteSession(sessionStore.currentSessionId);
      sessionStore.currentSessionId = '';
      sessionStore.pendingSessionId = '';
    }
  }
};

