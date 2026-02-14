<script setup lang="ts">
import HomeMenu from './components/homeMenu/HomeMenu.vue';
</script>

<template>
  <a-layout class="layout">
    <a-layout-sider class="layout__sider" :width="56" :collapsed-width="56">
      <HomeMenu />
    </a-layout-sider>
    <a-layout-content class="layout__content">
      <RouterView />
    </a-layout-content>
  </a-layout>
</template>

<style lang="less">
@import './Layout.less';
</style>
