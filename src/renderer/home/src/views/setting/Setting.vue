<template>
  <div class="full-container setting">
    <div class="setting__header">
      <h2 class="setting__title">{{ $t('setting.title') }}</h2>
    </div>
    <div class="setting__body">
      <a-tabs default-active-key="database" class="setting__tabs">
        <a-tab-pane key="database" :title="$t('setting.database.tabTitle')">
          <DatabaseSetting />
        </a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import DatabaseSetting from './components/DatabaseSetting/DatabaseSetting.vue';
</script>

<style lang="less">
@import './Setting.less';
</style>
