<template>
  <div class="message-list" ref="listRef">
    <MessageItem
      v-for="msg in messageStore.showedMessageList"
      :key="msg.id"
      :role="msg.role"
      :content="msg.content"
    />

    <MessageItem
      v-if="messageStore.isStreaming"
      role="assistant"
      :content="messageStore.streamingContent || '...'"
      :is-streaming="true"
    />

    <div v-if="!messageStore.showedMessageList.length && !messageStore.isStreaming" class="message-list__empty">
      {{ i18nHelper.chat.noMessages }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useThrottleFn } from '@vueuse/core';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { messageStore } from '../../../store/message.store';
import MessageItem from '../MessageItem/MessageItem.vue';

const listRef = ref<HTMLElement | null>(null);
const isBrowsingHistory = ref(false);

const scrollToBottom = (): void => {
  nextTick(() => {
    if (listRef.value) {
      listRef.value.scrollTop = listRef.value.scrollHeight;
    }
  });
};

const throttledScrollToBottom = useThrottleFn(
  () => {
    if (!isBrowsingHistory.value) {
      scrollToBottom();
    }
  },
  200,
  true,
  true,
);

const handleScroll = (): void => {
  if (!listRef.value) return;
  const { scrollTop, scrollHeight, clientHeight } = listRef.value;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

  if (distanceFromBottom < 60) {
    isBrowsingHistory.value = false;
  } else if (distanceFromBottom > 100) {
    isBrowsingHistory.value = true;
  }
};

const resetBrowsingMode = (): void => {
  isBrowsingHistory.value = false;
  scrollToBottom();
};

watch(() => messageStore.streamingContent, () => throttledScrollToBottom());
watch(() => messageStore.showedMessageList.length, (newLen, oldLen) => {
  if (newLen > oldLen) {
    resetBrowsingMode();
  }
});

onMounted(() => {
  if (listRef.value) {
    listRef.value.addEventListener('scroll', handleScroll);
  }
});

onUnmounted(() => {
  if (listRef.value) {
    listRef.value.removeEventListener('scroll', handleScroll);
  }
});

defineExpose({ scrollToBottom: resetBrowsingMode });
</script>

<style lang="less">
@import './MessageList.less';
</style>
