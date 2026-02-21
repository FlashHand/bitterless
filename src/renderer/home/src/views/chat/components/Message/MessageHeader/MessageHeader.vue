<template>
  <div class="message-header">
    <span class="message-header__title">{{ title || $t('chat.untitled') }}</span>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t: $t } = useI18n();

defineProps<{
  title: string;
}>();
</script>

<style lang="less">
@import './MessageHeader.less';
</style>
