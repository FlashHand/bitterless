<template>
  <a-drawer
    :visible="wechatStore.drawerVisible"
    :width="480"
    :footer="false"
    @cancel="wechatStore.closeDrawer()"
  >
    <template #title>
      {{ i18nHelper.connector.name.wechat }}
    </template>
    <div class="wechat-config">
      <div class="wechat-config__header">
        <div class="wechat-config__header-left">
          <a-tag v-if="wechatStore.loggedIn" color="green">
            {{ i18nHelper.connector.connected }}: {{ wechatStore.nickName }}
          </a-tag>
          <a-tag v-else color="red">
            {{ i18nHelper.connector.notLoggedIn }}
          </a-tag>
        </div>
        <div class="wechat-config__header-right">
          <span v-if="wechatStore.error" class="wechat-config__error">{{ wechatStore.error }}</span>
        </div>
      </div>

      <div v-if="!wechatStore.loggedIn && !wechatStore.loggingIn && !wechatStore.qrcodeUrl" class="wechat-config__action">
        <a-button type="primary" @click="wechatStore.startLoginFlow()">
          {{ i18nHelper.connector.startLogin }}
        </a-button>
      </div>

      <div v-if="wechatStore.loggingIn && !wechatStore.qrcodeUrl" class="wechat-config__loading">
        <a-spin />
      </div>

      <div v-if="wechatStore.qrcodeUrl && !wechatStore.loggedIn" class="wechat-config__qrcode">
        <p>{{ i18nHelper.connector.scanQrcode }}</p>
        <img :src="wechatStore.qrcodeUrl" alt="QR Code" />
      </div>

      <div class="wechat-config__env">
        <h3 class="wechat-config__env-title">{{ i18nHelper.connector.envVariables }}</h3>
        <EnvForm
          v-model="wechatStore.env"
          @save="handleEnvSave"
          @cancel="handleEnvCancel"
        />
      </div>
    </div>
  </a-drawer>
</template>

<script setup lang="ts">
import { Message } from '@arco-design/web-vue';
import { wechatStore } from './wechat.store';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import EnvForm from '@renderer/common/components/EnvForm/EnvForm.vue';

const handleEnvSave = async (env: Record<string, string>): Promise<void> => {
  try {
    await wechatStore.saveEnv(env);
    Message.success(i18nHelper.common.envForm.saveSuccess);
  } catch (err) {
    Message.error(i18nHelper.common.envForm.saveFailed);
  }
};

const handleEnvCancel = (): void => {
  console.log('[wechat] env edit cancelled');
};
</script>

<style scoped>
@import './WechatConfig.less';
</style>
