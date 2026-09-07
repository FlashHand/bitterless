<template>
  <div name="onlypreview__markdownPreview" class="onlypreview-markdown">
    <div
      v-if="linkError"
      name="onlypreview__markdownLinkError"
      class="onlypreview-markdown__link-error"
      role="alert"
    >
      {{ linkError }}
    </div>
    <!-- eslint-disable vue/no-v-html -- only generated link/anchor metadata survives sanitization. -->
    <article
      v-if="renderResult.ok"
      ref="documentRef"
      name="onlypreview__markdownDocument"
      class="onlypreview-markdown__document"
      @click="handleLink"
      @keydown="handleLinkKeydown"
      v-html="renderResult.html"
    ></article>
    <div v-else name="onlypreview__markdownError" class="onlypreview-markdown__error" role="alert">
      {{ markdownError }}
    </div>
    <!-- eslint-enable vue/no-v-html -->
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewTextContent } from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewClient } from '../../../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../../../common/contextBridge/onlyPreviewEnv.bridge';
import { countOnlyPreviewDomSelection } from '../../onlyPreviewCharacterCount.service';
import { renderOnlyPreviewMarkdown } from '../../onlyPreviewMarkdown.service';
import {
  findOnlyPreviewMarkdownLink,
  scrollOnlyPreviewMarkdownAnchor
} from '../../onlyPreviewMarkdownLink.service';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';

const props = defineProps<{
  content: OnlyPreviewTextContent;
  reportingRevision: string;
  fragment?: string;
}>();
const documentRef = ref<HTMLElement | null>(null);
const linkError = ref('');
let linkGeneration = 0;

const renderResult = computed(() =>
  renderOnlyPreviewMarkdown(props.content.text, props.content.size, window, true)
);

const handleLink = async (event: MouseEvent | KeyboardEvent): Promise<void> => {
  const rendered = renderResult.value;
  if (!rendered.ok) return;
  const href = findOnlyPreviewMarkdownLink(documentRef.value, event.target, rendered.links);
  if (href === null) return;
  event.preventDefault();
  event.stopPropagation();
  linkError.value = '';
  if (href.startsWith('#')) {
    scrollOnlyPreviewMarkdownAnchor(documentRef.value, href);
    return;
  }
  const generation = ++linkGeneration;
  const reportingRevision = props.reportingRevision;
  const selectionRevision = Number(reportingRevision);
  const { hostToken, previewRuntimeToken } = onlyPreviewEnv;
  if (
    !hostToken ||
    !previewRuntimeToken ||
    !reportingRevision ||
    !Number.isSafeInteger(selectionRevision)
  ) {
    linkError.value = onlyPreviewI18n.recents.linkFailed;
    return;
  }
  try {
    unwrapOnlyPreviewResult(
      await onlyPreviewClient.openMarkdownLink({
        hostToken,
        previewRuntimeToken,
        selectionRevision,
        href
      })
    );
    if (
      generation === linkGeneration &&
      props.reportingRevision === reportingRevision &&
      href.includes('#')
    ) {
      scrollOnlyPreviewMarkdownAnchor(documentRef.value, href.slice(href.indexOf('#')));
    }
  } catch {
    if (generation === linkGeneration && props.reportingRevision === reportingRevision) {
      linkError.value = onlyPreviewI18n.recents.linkFailed;
    }
  }
};

const handleLinkKeydown = (event: KeyboardEvent): void => {
  if (!event.isComposing && (event.key === 'Enter' || event.key === ' ')) void handleLink(event);
};

watch(
  () => props.fragment,
  async (fragment) => {
    if (fragment === undefined) return;
    await nextTick();
    scrollOnlyPreviewMarkdownAnchor(documentRef.value, fragment, false);
  },
  { immediate: true, flush: 'post' }
);

const markdownError = computed(() =>
  !renderResult.value.ok && renderResult.value.reason === 'too-large'
    ? onlyPreviewI18n.preview.markdownLimit
    : onlyPreviewI18n.preview.failedTitle
);

const reportSelection = (): void => {
  onlyPreviewPreviewStore.reportCharacterCount(
    countOnlyPreviewDomSelection(documentRef.value, window.getSelection()),
    props.reportingRevision
  );
};

watch(
  () => [
    props.content.workspaceId,
    props.content.relativePath,
    props.content.text,
    props.reportingRevision
  ],
  () => {
    linkGeneration += 1;
    linkError.value = '';
    onlyPreviewPreviewStore.reportCharacterCount(0, props.reportingRevision);
  },
  { immediate: true }
);

onMounted(() => {
  document.addEventListener('selectionchange', reportSelection);
  if (renderResult.value.ok) {
    onlyPreviewPreviewStore.armCharacterCountReporting(props.reportingRevision);
    onlyPreviewPreviewStore.reportSurfaceReady(props.reportingRevision);
    return;
  }
  onlyPreviewPreviewStore.reportSurfaceError(
    props.reportingRevision,
    renderResult.value.reason === 'too-large' ? 'TEXT_TOO_LARGE' : 'OPERATION_FAILED'
  );
});
onBeforeUnmount(() => {
  linkGeneration += 1;
  document.removeEventListener('selectionchange', reportSelection);
  onlyPreviewPreviewStore.reportCharacterCount(0, props.reportingRevision);
});
</script>

<style lang="less">
@import './MarkdownPreview.less';
</style>
