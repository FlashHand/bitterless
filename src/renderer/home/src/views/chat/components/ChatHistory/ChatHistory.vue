<template>
  <div class="chat-history">
    <div class="chat-history__toolbar">
      <div class="chat-history__toolbar__btn" @click="onCreateSession" :title="$t('chat.newSession')">
        <icon-plus :size="18" />
      </div>
    </div>
    <div class="chat-history__list">
      <div
        v-for="session in sessionStore.sessionList"
        :key="session.sessionId"
        class="chat-history__item"
        :class="{
          'chat-history__item--active': session.sessionId === sessionStore.currentSessionId,
          'chat-history__item--pinned': session.pinned,
        }"
        @click="onSelectSession(session.sessionId)"
      >
        <div class="chat-history__item__info">
          <template v-if="renamingId === session.sessionId">
            <input
              class="chat-history__rename-input"
              v-model="renameValue"
              @keydown.enter="onConfirmRename(session.sessionId)"
              @blur="onConfirmRename(session.sessionId)"
              @click.stop
              ref="renameInputRef"
            />
          </template>
          <template v-else>
            <div class="chat-history__item__title">{{ session.title }}</div>
            <div class="chat-history__item__time">{{ formatTime(session.createdAt) }}</div>
          </template>
        </div>
        <div class="chat-history__item__actions" @click.stop>
          <div
            class="chat-history__item__action-btn"
            :title="session.pinned ? $t('chat.unpinSession') : $t('chat.pinSession')"
            @click="onTogglePin(session)"
          >
            <icon-pushpin :size="14" />
          </div>
          <div
            class="chat-history__item__action-btn"
            :title="$t('chat.renameSession')"
            @click="onStartRename(session)"
          >
            <icon-edit :size="14" />
          </div>
          <div
            class="chat-history__item__action-btn chat-history__item__action-btn--danger"
            :title="$t('chat.deleteSession')"
            @click="onDeleteSession(session.sessionId)"
          >
            <icon-delete :size="14" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconPlus, IconPushpin, IconEdit, IconDelete } from '@arco-design/web-vue/es/icon';
import dayjs from 'dayjs';
import {
  sessionStore,
  createSession,
  selectSession,
  deleteSession,
  renameSession,
  pinSession,
  unpinSession,
} from '../../store/session.store';
import type { SessionItem } from '../../store/session.store';

const { t: $t } = useI18n();

const renamingId = ref('');
const renameValue = ref('');
const renameInputRef = ref<HTMLInputElement[] | null>(null);

const emit = defineEmits<{
  sessionSelected: [sessionId: string];
}>();

const formatTime = (dateStr: string): string => {
  if (!dateStr) return '';
  return dayjs(dateStr).format('MM-DD HH:mm');
};

const onCreateSession = async (): Promise<void> => {
  const sessionId = await createSession();
  emit('sessionSelected', sessionId);
};

const onSelectSession = (sessionId: string): void => {
  selectSession(sessionId);
  emit('sessionSelected', sessionId);
};

const onDeleteSession = async (sessionId: string): Promise<void> => {
  await deleteSession(sessionId);
};

const onTogglePin = async (session: SessionItem): Promise<void> => {
  if (session.pinned) {
    await unpinSession(session.sessionId);
  } else {
    await pinSession(session.sessionId);
  }
};

const onStartRename = (session: SessionItem): void => {
  renamingId.value = session.sessionId;
  renameValue.value = session.title;
  nextTick(() => {
    if (renameInputRef.value && renameInputRef.value.length > 0) {
      renameInputRef.value[0].focus();
    }
  });
};

const onConfirmRename = async (sessionId: string): Promise<void> => {
  if (renameValue.value.trim()) {
    await renameSession(sessionId, renameValue.value.trim());
  }
  renamingId.value = '';
  renameValue.value = '';
};
</script>

<style lang="less">
@import './ChatHistory.less';
</style>
