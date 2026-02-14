
<script setup lang="ts">
defineProps<{
  icon: string;
  label: string;
  active?: boolean;
}>();
</script>

<template>
  <div class="home-menu-item" :class="{ 'home-menu-item--active': active }">
    <div class="home-menu-item__icon">{{ icon }}</div>
    <div class="home-menu-item__label">{{ label }}</div>
  </div>
</template>

<style lang="less">
@import './HomeMenuItem.less';
</style>
