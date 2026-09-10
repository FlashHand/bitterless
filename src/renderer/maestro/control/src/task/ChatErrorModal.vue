<script setup lang="ts">
import { IconX } from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue'
import type { ChatErrorCard } from '../store/message.type'
import './ChatErrorModal.less'

/**
 * 错误全文弹窗（Ral 2026-09-10：「show detail 按钮展示一个 modal 展示完整 error」）。
 *
 * **不用 Arco 的 `a-modal`**，也不挂 body —— 挂在 ChatPanel 根之内，与
 * `ContextGraphModal` 同一条先例，两个理由写在 ChatPanel 那处注释里:
 *  ① 遮罩只该盖住这一个面板（control 是 380–480px 的侧栏），盖住整窗会把旁边的 Workbench 一起锁掉；
 *  ② 全文是要被选中复制的，落点必须与遮罩同一个定位上下文。
 *
 * 可关（Esc / 点遮罩 / 关闭按钮）—— 项目规则：弹窗一律留关闭路径。
 */

defineProps<{ card: ChatErrorCard }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div
    name="chatErrorModal"
    class="chat-error-modal"
    @click="emit('close')"
    @keydown.esc="emit('close')"
  >
    <!-- `@click.stop`:点内容区不该关掉它 —— 全文是要被选中复制的。 -->
    <div class="chat-error-modal__panel" @click.stop>
      <div class="chat-error-modal__header">
        <div class="chat-error-modal__title" :title="card.title">{{ card.title }}</div>
        <IconBtn
          name="chatErrorModal__close"
          class="chat-error-modal__close"
          :aria-label="i18nHelper.maestroControl.chat.closeErrorDetail"
          @click="emit('close')"
        >
          <IconX :size="15" stroke="1.8" />
        </IconBtn>
      </div>
      <div v-if="card.subtitle" class="chat-error-modal__subtitle">{{ card.subtitle }}</div>
      <!-- `pre` 而不是 markdown:错误全文里的缩进与换行**就是**信息（栈的层级）。 -->
      <pre name="chatErrorModal__detail" class="chat-error-modal__detail">{{ card.detail }}</pre>
    </div>
  </div>
</template>
