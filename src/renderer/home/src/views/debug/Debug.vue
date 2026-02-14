<script setup lang="ts">
import { reactive, onMounted } from 'vue';

class DebugStore {
  env = import.meta.env.VITE_ENV || '';
  appPath = '';
  userDataPath = '';
}

const store = reactive<DebugStore>(new DebugStore());

onMounted(async () => {
  store.appPath = await window.pathHelper.getAppPath();
  store.userDataPath = await window.pathHelper.getUserDataPath();
});
</script>

<template>
  <div class="debug">
    <a-descriptions :column="1" bordered>
      <a-descriptions-item label="环境">{{ store.env }}</a-descriptions-item>
      <a-descriptions-item label="App Path">{{ store.appPath }}</a-descriptions-item>
      <a-descriptions-item label="User Data Path">{{ store.userDataPath }}</a-descriptions-item>
    </a-descriptions>
  </div>
</template>

<style lang="less">
@import './Debug.less';
</style>
