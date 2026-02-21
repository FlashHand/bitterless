<template>
  <div class="full-container chat">
    <div class="chat__sidebar">
      <ChatHistory @session-selected="onSessionSelected" />
    </div>
    <div class="chat__main">
      <Message />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue';
import ChatHistory from './components/ChatHistory/ChatHistory.vue';
import Message from './components/Message/Message.vue';
import { messageStore, initMessageListeners } from './store/message.store';
import { sessionStore, loadSessions } from './store/session.store';

const onSessionSelected = (sessionId: string): void => {
  messageStore.currentSessionId = sessionId;
  const session = sessionStore.sessionList.find((s) => s.sessionId === sessionId);
  messageStore.currentTitle = session?.title ?? '';
  messageStore.messageListService.loadHistory();
};

watch(
  () => sessionStore.currentSessionId,
  (sessionId) => {
    if (sessionId) {
      messageStore.currentSessionId = sessionId;
      const session = sessionStore.sessionList.find((s) => s.sessionId === sessionId);
      messageStore.currentTitle = session?.title ?? '';
      messageStore.messageListService.loadHistory();
    }
  },
);

onMounted(async () => {
  initMessageListeners();
  await loadSessions();
});
</script>

<style lang="less">
@import './Chat.less';
</style>
