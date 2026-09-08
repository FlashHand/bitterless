<template>
  <div name="onlypreview__fileActions" class="onlypreview-file-actions">
    <IconBtn
      name="onlypreview__fileActionsMenu"
      class="onlypreview-file-actions__button"
      :title="onlyPreviewI18n.preview.fileActions"
      :aria-label="onlyPreviewI18n.preview.fileActions"
      aria-haspopup="menu"
      :aria-expanded="onlyPreviewShellStore.previewFileMenuOpen"
      :disabled="!onlyPreviewShellStore.previewFileRef || onlyPreviewShellStore.previewFileMenuOpen"
      @click="onlyPreviewShellStore.showPreviewFileMenu()"
    >
      <IconDotsVertical :size="16" aria-hidden="true" />
    </IconBtn>
    <span
      v-if="onlyPreviewShellStore.previewActionError"
      name="onlypreview__fileActionError"
      class="onlypreview-file-actions__error"
      role="alert"
      :title="onlyPreviewShellStore.previewActionError"
    >
      <IconAlertTriangle :size="14" aria-hidden="true" />
    </span>
  </div>
</template>

<script setup lang="ts">
import { IconAlertTriangle, IconDotsVertical } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewShellStore } from '../../onlyPreviewShell.store';
</script>

<style lang="less">
@import './FileActions.less';
</style>
