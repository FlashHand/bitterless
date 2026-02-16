<script setup lang="ts">
import HomeMenu from './components/homeMenu/HomeMenu.vue';
import MenuBar from '../../components/MenuBar/MenuBar.vue';
</script>

<template>
  <div class="layout">
    <MenuBar />
    <a-layout class="layout__body">
      <a-layout-sider class="layout__sider" :width="56" :collapsed-width="56">
        <HomeMenu />
      </a-layout-sider>
      <a-layout-content class="layout__content">
        <RouterView />
      </a-layout-content>
    </a-layout>
  </div>
</template>

<style lang="less">
@import './Layout.less';
</style>
