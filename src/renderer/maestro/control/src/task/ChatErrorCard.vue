<script setup lang="ts">
import { computed } from 'vue'
import { IconAlertTriangle } from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { messageStore } from '../store/message.store'
import type { ChatMessage } from '../store/message.type'
import './ChatErrorCard.less'

/**
 * 时间线上的错误卡（Ral 2026-09-10）。
 *
 * 三层刻意分开:标题一行（是什么坏了）、副标题一行（在哪一步）、全文按需展开。
 * 全文不铺在时间线上 —— 一条 `An object could not be cloned.` 带几十行栈，铺开会把上下文顶掉，
 * 而那正是这张卡要解决的问题（在此之前它是混在正常气泡里的一行红字）。
 *
 * 「看全文」不在这里开弹窗，而是写进 store：卡片长在消息列表深处，
 * 弹窗必须挂在**面板根**（遮罩只该盖住这一个面板，且落点要与遮罩同一定位上下文）——
 * 与 `ContextGraphModal` 同一条先例。
 */

const props = defineProps<{ message: ChatMessage }>()
const card = computed(() => props.message.errorCard)
</script>

<template>
  <div v-if="card" name="messageItem__errorCard" class="chat-error-card">
    <IconAlertTriangle class="chat-error-card__icon" :size="15" stroke="1.8" />
    <div class="chat-error-card__body">
      <div name="messageItem__errorCard__title" class="chat-error-card__title" :title="card.title">
        {{ card.title }}
      </div>
      <div
        v-if="card.subtitle"
        name="messageItem__errorCard__subtitle"
        class="chat-error-card__subtitle"
        :title="card.subtitle"
      >
        {{ card.subtitle }}
      </div>
    </div>
    <button
      name="messageItem__errorCard__detail"
      type="button"
      class="chat-error-card__detail"
      @click="messageStore.showErrorDetail(card)"
    >
      {{ i18nHelper.maestroControl.chat.showErrorDetail }}
    </button>
  </div>
</template>
