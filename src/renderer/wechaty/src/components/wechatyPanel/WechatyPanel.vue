<script setup lang="ts">
import { rigchatStore } from '../../store/rigchat.store'
</script>

<template>
  <div class="wechaty-panel">
    <div class="wechaty-panel__header">
      <a-tag v-if="rigchatStore.loggedIn" color="green">已登录: {{ rigchatStore.nickName }}</a-tag>
      <a-tag v-else color="blue">Rigchat Bot</a-tag>
      <p v-if="rigchatStore.error" class="wechaty-panel__error">{{ rigchatStore.error }}</p>
    </div>

    <div v-if="rigchatStore.qrcodeUrl && !rigchatStore.loggedIn" class="wechaty-panel__qrcode">
      <p>请使用微信扫描二维码登录</p>
      <img :src="rigchatStore.qrcodeUrl" alt="QR Code" />
    </div>

    <div v-if="rigchatStore.loggedIn" class="wechaty-panel__messages">
      <div
        v-for="(msg, idx) in rigchatStore.messages"
        :key="idx"
        class="wechaty-panel__message-item"
      >
        <span class="wechaty-panel__message-time">{{ msg.time }}</span>
        <span class="wechaty-panel__message-talker">{{ msg.talker }}</span>
        <img
          v-if="msg.imagePath"
          class="wechaty-panel__message-image"
          :src="'file://' + msg.imagePath"
          alt="image"
        />
        <span v-else class="wechaty-panel__message-content">{{ msg.content }}</span>
      </div>
    </div>
  </div>
</template>

<style lang="less">
@import './WechatyPanel.less';
</style>
