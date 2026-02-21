<template>
  <div class="message-input">
    <div class="message-input__editor">
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
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import QuillEditor from '@/components/QuillEditor/QuillEditor.vue';
import { messageStore, sendMessage } from '../../../store/message.store';

const { t } = useI18n();
const quillRef = ref<InstanceType<typeof QuillEditor> | null>(null);
const placeholder = computed(() => t('chat.inputPlaceHolder'));

const emit = defineEmits<{
  sent: [];
}>();

const handleSubmit = async (content: string): Promise<void> => {
  await sendMessage(content);
  emit('sent');
};

const focus = (): void => {
  quillRef.value?.focus();
};

defineExpose({ focus });
</script>

<style lang="less">
@import './MessageInput.less';
</style>
