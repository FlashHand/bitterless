<template>
  <div class="message">
    <div class="message__header">
      <MessageHeader :title="messageStore.currentTitle" />
    </div>
    <div class="message__list">
      <MessageList ref="messageListRef" />
    </div>
    <div class="message__input">
      <MessageInput ref="messageInputRef" @sent="onSent" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import MessageHeader from './MessageHeader/MessageHeader.vue';
import MessageList from './MessageList/MessageList.vue';
import MessageInput from './MessageInput/MessageInput.vue';
import { messageStore } from '../../store/message.store';

const messageListRef = ref<InstanceType<typeof MessageList> | null>(null);
const messageInputRef = ref<InstanceType<typeof MessageInput> | null>(null);

const onSent = (): void => {
  messageListRef.value?.scrollToBottom();
};

onMounted(() => {
  messageInputRef.value?.focus();
});
</script>

<style lang="less">
@import './Message.less';
</style>
