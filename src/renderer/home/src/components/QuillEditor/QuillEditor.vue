<template>
  <div class="quill-editor">
    <div class="quill-editor__container" ref="editorRef"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import Quill from 'quill';
import 'quill/dist/quill.bubble.css';

interface Props {
  placeholder?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '输入消息...',
  disabled: false,
});

const emit = defineEmits<{
  submit: [content: string];
}>();

const editorRef = ref<HTMLElement | null>(null);
let quill: Quill | null = null;

const getPlainText = (): string => {
  if (!quill) return '';
  return quill.getText().trim();
};

const clear = (): void => {
  if (!quill) return;
  quill.setText('');
};

const focus = (): void => {
  if (!quill) return;
  quill.focus();
};

onMounted(() => {
  if (!editorRef.value) return;

  quill = new Quill(editorRef.value, {
    theme: 'bubble',
    placeholder: props.placeholder,
    modules: {
      toolbar: false,
      keyboard: {
        bindings: {
          enter: {
            key: 'Enter',
            handler: () => {
              const text = getPlainText();
              if (text) {
                emit('submit', text);
                clear();
              }
            },
          },
          shiftEnter: {
            key: 'Enter',
            shiftKey: true,
            handler: (_range: any, _context: any) => {
              if (!quill) return true;
              const selection = quill.getSelection();
              if (selection) {
                quill.insertText(selection.index, '\n');
                quill.setSelection(selection.index + 1, 0);
              }
              return false;
            },
          },
        },
      },
    },
  });
});

watch(
  () => props.disabled,
  (val) => {
    if (quill) {
      quill.enable(!val);
    }
  },
);

onBeforeUnmount(() => {
  quill = null;
});

defineExpose({ getPlainText, clear, focus });
</script>

<style lang="less">
@import './QuillEditor.less';
</style>
