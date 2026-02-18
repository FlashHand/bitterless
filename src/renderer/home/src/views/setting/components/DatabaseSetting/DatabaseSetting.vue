<template>
  <div class="database-setting">
    <div class="database-setting__form">
      <div class="database-setting__field">
        <label class="database-setting__label">{{ $t('setting.database.sqlitePassword') }}</label>
        <a-input-password
          v-model="settingStore.databaseSetting.sqlitePassword"
          :placeholder="$t('setting.database.sqlitePasswordPlaceholder')"
          class="database-setting__input"
          allow-clear
        />
      </div>
      <div class="database-setting__field">
        <label class="database-setting__label">{{ $t('setting.database.qdrantApiKey') }}</label>
        <a-input-password
          v-model="settingStore.databaseSetting.qdrantApiKey"
          :placeholder="$t('setting.database.qdrantApiKeyPlaceholder')"
          class="database-setting__input"
          allow-clear
        />
      </div>
      <div class="database-setting__actions">
        <a-button type="primary" :loading="settingStore.loading" @click="handleSave">
          {{ $t('setting.database.save') }}
        </a-button>
        <span v-if="settingStore.saveStatus === 'success'" class="database-setting__status--success">
          {{ $t('setting.database.saveSuccess') }}
        </span>
        <span v-if="settingStore.saveStatus === 'failed'" class="database-setting__status--failed">
          {{ $t('setting.database.saveFailed') }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { settingStore, loadDatabaseSetting, saveDatabaseSetting } from '../../store/setting.store';

const handleSave = async (): Promise<void> => {
  await saveDatabaseSetting();
};

onMounted(() => {
  loadDatabaseSetting();
});
</script>

<style lang="less">
@import './DatabaseSetting.less';
</style>
