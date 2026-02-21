<script setup lang="ts">
import { proxySettingStore } from '@/views/setting/components/ProxySetting/proxySetting.store';

const title = import.meta.env.VITE_MAIN_TITLE || 'BitterLess';
</script>

<template>
  <div class="menu-bar">
    <span class="menu-bar__title">{{ title }}</span>
    <div v-if="proxySettingStore.activeSetting.switch" class="menu-bar__status">
      <span class="menu-bar__status-dot"></span>
      <span class="menu-bar__status-text">Proxy</span>
    </div>
  </div>
</template>

<style lang="less">
@import './MenuBar.less';
</style>
