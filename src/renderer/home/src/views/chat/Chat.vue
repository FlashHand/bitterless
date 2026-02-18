<template>
  <div class="full-container chat">
    <div class="chat__message-list" ref="messageListRef">
      <div
        v-for="msg in messageStore.messageList"
        :key="msg.id"
        class="chat__message-item"
        :class="{ 'chat__message-item--user': msg.role === 'user', 'chat__message-item--assistant': msg.role === 'assistant' }"
      >
        <div class="chat__message-item__avatar">
          {{ msg.role === 'user' ? '👤' : '🤖' }}
        </div>
        <div class="chat__message-item__content">
          <MarkdownRender v-if="msg.role === 'assistant'" :content="msg.content" />
          <div v-else class="chat__message-item__text">{{ msg.content }}</div>
        </div>
      </div>

      <div v-if="messageStore.isStreaming" class="chat__message-item chat__message-item--assistant">
        <div class="chat__message-item__avatar">🤖</div>
        <div class="chat__message-item__content">
          <MarkdownRender
            :content="messageStore.streamingContent || '...'"
            :max-live-nodes="0"
            :batch-rendering="{ renderBatchSize: 16, renderBatchDelay: 8 }"
          />
        </div>
      </div>
    </div>

    <div class="chat__input-area">
      <QuillEditor
        ref="quillRef"
        :disabled="messageStore.isStreaming"
        :placeholder="placeholder"
        @submit="handleSubmit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { i18nMessages } from '@renderer/common/i18n/i18n.helper';
import MarkdownRender from 'markstream-vue';
import QuillEditor from '@/components/QuillEditor/QuillEditor.vue';
import { messageStore, initMessageListeners, sendMessage } from './store/message.store';

const placeholder = computed(() => i18nMessages.chat.inputPlaceHolder);
const messageListRef = ref<HTMLElement | null>(null);
const quillRef = ref<InstanceType<typeof QuillEditor> | null>(null);

const scrollToBottom = (): void => {
  nextTick(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
    }
  });
};

const handleSubmit = async (content: string): Promise<void> => {
  await sendMessage(content);
  scrollToBottom();
};

watch(
  () => messageStore.streamingContent,
  () => scrollToBottom(),
);

watch(
  () => messageStore.messageList.length,
  () => scrollToBottom(),
);

onMounted(() => {
  initMessageListeners();
  quillRef.value?.focus();
});
</script>

<style lang="less">
@import './Chat.less';
</style>
