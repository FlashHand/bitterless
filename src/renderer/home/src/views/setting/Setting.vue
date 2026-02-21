<template>
  <div class="bl-full-container setting">
    <div class="setting__header">
      <h2 class="setting__title">{{ i18nHelper.setting.title }}</h2>
    </div>
    <div class="setting__body">
      <a-tabs default-active-key="llm" class="setting__tabs" @change="onTabChange">
        <a-tab-pane key="llm" :title="i18nHelper.setting.llm.tabTitle">
          <LLMSetting />
        </a-tab-pane>
        <a-tab-pane key="proxy" :title="i18nHelper.setting.proxy.tabTitle">
          <ProxySetting />
        </a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import LLMSetting from './components/LLMSetting/LLMSetting.vue';
import ProxySetting from './components/ProxySetting/ProxySetting.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { loadProxySetting } from './components/ProxySetting/proxySetting.store';

const onTabChange = (key: string): void => {
  if (key === 'proxy') {
    loadProxySetting();
  }
};
</script>

<style lang="less">
@import './Setting.less';
</style>
