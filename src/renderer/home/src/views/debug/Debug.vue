<script setup lang="ts">
import { reactive, onMounted } from 'vue';
import { xpcRenderer } from 'electron-buff/xpc/renderer';
import { pathHelper } from 'electron-buff/pathHelper/renderer';

class DebugStore {
  env = import.meta.env.VITE_ENV || '';
  appPath = '';
  userDataPath = '';
}

const store = reactive<DebugStore>(new DebugStore());

onMounted(async () => {
  store.appPath = await pathHelper.getAppPath();
  store.userDataPath = await pathHelper.getUserDataPath();
});

const testInvalid = async () => {
  console.log('[testInvalid] sending to main process...');
  const result = await xpcRenderer.send('testInvalid');
  console.log('[testInvalid] result:', result);
};

const testSqliteHello = async () => {
  console.log('[testSqliteHello] sending sqlite/hello...');
  const result = await xpcRenderer.send('sqlite/hello');
  console.log('[testSqliteHello] result:', result);
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
    <a-button type="primary" style="margin-top: 16px; margin-left: 8px" @click="testSqliteHello">测试 SQLite 监听</a-button>
  </div>
</template>

<style lang="less">
@import './Debug.less';
</style>
