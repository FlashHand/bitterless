<script setup lang="ts">
const title = import.meta.env.VITE_MAIN_TITLE || 'BitterLess';
</script>

<template>
  <div class="menu-bar">
    <span class="menu-bar__title">{{ title }}</span>
  </div>
</template>

<style lang="less">
@import './MenuBar.less';
</style>
