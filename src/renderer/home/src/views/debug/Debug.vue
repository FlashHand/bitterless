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

const testInvalid = async () => {
  console.log('[testInvalid] sending to main process...');
  const result = await window.xpcRenderer.send('testInvalid');
  console.log('[testInvalid] result:', result);
};
</script>

<template>
  <div class="debug">
    <a-descriptions :column="1" bordered>
      <a-descriptions-item label="环境">{{ store.env }}</a-descriptions-item>
      <a-descriptions-item label="App Path">{{ store.appPath }}</a-descriptions-item>
      <a-descriptions-item label="User Data Path">{{ store.userDataPath }}</a-descriptions-item>
    </a-descriptions>
    <a-button type="primary" style="margin-top: 16px" @click="testInvalid">测试无效监听</a-button>
  </div>
</template>

<style lang="less">
@import './Debug.less';
</style>
