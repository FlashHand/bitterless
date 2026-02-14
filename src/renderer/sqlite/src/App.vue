<script setup lang="ts">
import { onMounted } from 'vue';
import type { XpcRendererApi } from 'electron-buff/xpc/preload';

const xpcRenderer = (window as any).xpcRenderer as XpcRendererApi;

onMounted(() => {
  xpcRenderer.handle('sqlite/hello', async () => {
    console.log('Received message from main process: sqlite/hello');
    return 'hello';
  });
});
</script>

<template>
  <div class="container">
    <h1>SQLite Manager</h1>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  font-family: sans-serif;
}
</style>
