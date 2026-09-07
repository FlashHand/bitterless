<template>
  <header name="onlypreview__previewToolbar" class="onlypreview-preview-toolbar">
    <div name="onlypreview__previewNavigation" class="onlypreview-preview-toolbar__navigation">
      <IconBtn
        name="onlypreview__previewBack"
        class="onlypreview-preview-toolbar__navigation-button"
        :title="onlyPreviewI18n.recents.back"
        :aria-label="onlyPreviewI18n.recents.back"
        :disabled="!onlyPreviewRecentsStore.canBack"
        @click="onlyPreviewRecentsStore.navigate('back')"
      >
        <IconArrowLeft :size="16" aria-hidden="true" />
      </IconBtn>
      <IconBtn
        name="onlypreview__previewForward"
        class="onlypreview-preview-toolbar__navigation-button"
        :title="onlyPreviewI18n.recents.forward"
        :aria-label="onlyPreviewI18n.recents.forward"
        :disabled="!onlyPreviewRecentsStore.canForward"
        @click="onlyPreviewRecentsStore.navigate('forward')"
      >
        <IconArrowRight :size="16" aria-hidden="true" />
      </IconBtn>
      <IconBtn
        name="onlypreview__previewReload"
        class="onlypreview-preview-toolbar__navigation-button"
        :title="onlyPreviewI18n.recents.reload"
        :aria-label="onlyPreviewI18n.recents.reload"
        :disabled="!onlyPreviewRecentsStore.canReload"
        @click="onlyPreviewRecentsStore.reload()"
      >
        <IconReload :size="16" aria-hidden="true" />
      </IconBtn>
      <span
        v-if="onlyPreviewRecentsStore.errorMessage"
        name="onlypreview__navigationError"
        class="onlypreview-preview-toolbar__navigation-error"
        role="alert"
        :title="onlyPreviewRecentsStore.errorMessage"
        :aria-label="onlyPreviewRecentsStore.errorMessage"
      >
        <IconAlertTriangle :size="14" aria-hidden="true" />
      </span>
    </div>
    <div
      v-if="relativePath"
      name="onlypreview__previewIdentity"
      class="onlypreview-preview-toolbar__identity"
    >
      <span class="onlypreview-preview-toolbar__file-name">{{ fileName }}</span>
      <span class="onlypreview-preview-toolbar__file-path" :title="relativePath">
        {{ relativePath }}
      </span>
    </div>
    <FindBar v-if="onlyPreviewFindStore.open" />
    <span
      v-else-if="onlyPreviewFindStore.feedback"
      name="onlypreview__findFeedback"
      class="onlypreview-preview-toolbar__find-feedback"
      role="status"
    >
      {{ onlyPreviewFindStore.feedback }}
    </span>
    <div
      v-if="presentation?.fileRef"
      name="onlypreview__previewToolbarTrailing"
      class="onlypreview-preview-toolbar__trailing"
    >
      <span
        v-if="descriptorType"
        name="onlypreview__previewType"
        class="onlypreview-preview-toolbar__badge"
      >
        {{ descriptorType }}
      </span>
      <FileActions />
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IconAlertTriangle, IconArrowLeft, IconArrowRight, IconReload } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewRecentsStore } from '../../onlyPreviewRecents.store';
import { onlyPreviewShellStore } from '../../onlyPreviewShell.store';
import FileActions from '../FileActions/FileActions.vue';
import FindBar from '../FindBar/FindBar.vue';
import { onlyPreviewFindStore } from '../../onlyPreviewFind.store';

const presentation = computed(() => onlyPreviewShellStore.previewPresentation);
const relativePath = computed(
  () =>
    presentation.value?.descriptor?.relativePath || presentation.value?.fileRef?.relativePath || ''
);
const fileName = computed(
  () => presentation.value?.descriptor?.name || relativePath.value.split('/').at(-1) || ''
);
const descriptorType = computed(() => {
  const descriptor = presentation.value?.descriptor;
  if (descriptor) {
    return (
      descriptor.language ||
      descriptor.extension.replace(/^\./, '').toUpperCase() ||
      descriptor.kind
    );
  }
  return relativePath.value.split('.').at(-1)?.toUpperCase() || '';
});
</script>

<style lang="less">
@import './PreviewToolbar.less';
</style>
