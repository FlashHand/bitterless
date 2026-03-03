<template>
  <div class="bl-full-container">
    <div class="connector-page">
      <div class="connector-page__grid">
        <a-card
          v-for="connector in connectors"
          :key="connector.name"
          class="connector-page__card"
        >
          <template #title>
            <div class="connector-page__card-title">
              <img :src="connector.icon" :alt="connector.name" class="connector-page__card-icon" />
              <span>{{ i18nHelper.connector.name[connector.name] }}</span>
            </div>
          </template>
          <div class="connector-page__card-content">
            <div class="connector-page__card-status">
              <div class="connector-page__card-status-item">
                <span class="connector-page__card-status-label">{{ i18nHelper.connector.configStatus }}:</span>
                <span class="connector-page__card-status-value">{{ i18nHelper.connector.notConfigured }}</span>
              </div>
              <div class="connector-page__card-status-item">
                <span class="connector-page__card-status-label">{{ i18nHelper.connector.connectionStatus }}:</span>
                <span class="connector-page__card-status-value">{{ i18nHelper.connector.disconnected }}</span>
              </div>
            </div>
          </div>
          <template #actions>
            <a-button type="primary" @click="handleEditConfig(connector.name)">
              {{ i18nHelper.connector.editConfig }}
            </a-button>
          </template>
        </a-card>
      </div>
    </div>
    <WechatConfig />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import { connectors } from './store/connectors.constant';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { wechatStore } from './wechat/wechat.store';
import WechatConfig from './wechat/WechatConfig.vue';

interface RigchatHandler {
  init(): Promise<void>;
  checkLogin(): Promise<{ loggedIn: boolean; nickName: string }>;
  startLogin(): Promise<void>;
}

const rigchatEmitter = createXpcRendererEmitter<RigchatHandler>('RigchatHandler');

const handleEditConfig = (connectorName: string) => {
  if (connectorName === 'wechat') {
    wechatStore.openDrawer();
  }
};

onMounted(() => {
  rigchatEmitter.init().catch((err) => console.error('[connector] rigchat init failed:', err));
});
</script>

<style scoped>
@import './Connector.less';
</style>
