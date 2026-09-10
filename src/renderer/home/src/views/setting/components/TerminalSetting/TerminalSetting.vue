<template>
  <div name="terminal-setting" class="terminal-setting">
    <div name="terminal-setting__control" class="terminal-setting__control">
      <span id="terminal-setting__label" class="terminal-setting__label">
        {{ i18nHelper.setting.terminal.enable }}
      </span>
      <a-switch
        name="terminal-setting__switch"
        size="small"
        aria-labelledby="terminal-setting__label"
        :model-value="terminalSettingStore.enabled"
        :loading="terminalSettingStore.loading || terminalSettingStore.saving"
        :disabled="
          !terminalSettingStore.ready || terminalSettingStore.loading || terminalSettingStore.saving
        "
        @change="terminalSettingStore.change"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { terminalSettingStore } from './terminalSetting.store';

onMounted(() => void terminalSettingStore.load());
</script>

<style lang="less">
@import './TerminalSetting.less';
</style>
