<script setup lang="ts">
import { ref } from 'vue';
import type { XpcRendererApi } from 'electron-xpc/preload';

const xpcRenderer = (window as any).xpcRenderer as XpcRendererApi;
const result = ref<string>('');

const sendHello = async () => {
  const ret = await xpcRenderer.send('sqlite/hello');
  result.value = ret ?? 'null';
  console.log('sqlite/hello result:', ret);
};
</script>

<template>
  <div class="container">
    <h1>Home</h1>
    <button @click="sendHello">Send sqlite/hello</button>
    <p v-if="result">Result: {{ result }}</p>
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
  gap: 16px;
}

button {
  padding: 8px 24px;
  font-size: 16px;
  cursor: pointer;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
}

button:hover {
  background: #f0f0f0;
}
</style>
