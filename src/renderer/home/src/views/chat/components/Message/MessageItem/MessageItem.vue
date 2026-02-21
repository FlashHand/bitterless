<template>
  <div
    class="message-item"
    :class="{
      'message-item--user': role === 'user',
      'message-item--assistant': role === 'assistant',
    }"
  >
    <div class="message-item__avatar">
      {{ role === 'user' ? '👤' : '🤖' }}
    </div>
    <div class="message-item__content">
      <MarkdownRender
        v-if="role === 'assistant'"
        :content="content"
        :max-live-nodes="isStreaming ? 0 : undefined"
      />
      <div v-else class="message-item__text">{{ content }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import MarkdownRender from 'markstream-vue';

interface Props {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

withDefaults(defineProps<Props>(), {
  isStreaming: false,
});
</script>

<style lang="less">
@import './MessageItem.less';
</style>
