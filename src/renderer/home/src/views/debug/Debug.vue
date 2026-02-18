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
  <div class="debug full-container">
    <div class="debug__section">
      <div class="debug__section__title">环境变量</div>
      <a-descriptions :column="1" bordered size="small">
        <a-descriptions-item label="env">{{ store.env }}</a-descriptions-item>
      </a-descriptions>
    </div>

    <div class="debug__section">
      <div class="debug__section__title">应用目录</div>
      <a-descriptions :column="1" bordered size="small">
        <a-descriptions-item label="App Path">{{ store.appPath }}</a-descriptions-item>
        <a-descriptions-item label="User Data Path">{{ store.userDataPath }}</a-descriptions-item>
      </a-descriptions>
    </div>

    <div class="debug__section">
      <div class="debug__section__title">冒烟调试</div>
      <div class="debug__section__actions">
        <a-button type="primary" @click="testInvalid">测试无效监听</a-button>
        <a-button type="primary" @click="testSqliteHello">测试 SQLite 监听</a-button>
      </div>
    </div>
  </div>
</template>

<style lang="less">
@import './Debug.less';
</style>
