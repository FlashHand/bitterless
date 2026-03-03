<script setup lang="ts">
import { onMounted } from 'vue';
import { loadProxySetting } from '@/views/setting/components/ProxySetting/proxySetting.store';

onMounted(() => {
  loadProxySetting();
});
</script>

<template>
  <RouterView />
</template>

<style lang="less">
@import './App.less';
</style>
