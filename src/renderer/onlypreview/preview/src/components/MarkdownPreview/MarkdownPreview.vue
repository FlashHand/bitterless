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
    <!-- eslint-disable vue/no-v-html -- 两类内容进这里,都不是文档给的原始标记:
         ① 过完 DOMPurify 的文档内容,只有我们生成的 link/anchor 元数据能活下来;
         ② sanitize **之后**替换进去的 shiki 代码块 —— 外层标记由我们提供,代码文本由 shiki
            转义。之所以在之后替换:shiki 靠 inline style 上色,而白名单里没有 style/class,
            在之前替换会被剥成无色。见 onlyPreviewMarkdown.service 的
            highlightOnlyPreviewMarkdownCode。 -->
    <article
      v-if="renderResult.ok"
      ref="documentRef"
      name="onlypreview__markdownDocument"
      class="onlypreview-markdown__document"
      @click="handleLink"
      @keydown="handleLinkKeydown"
      v-html="documentHtml"
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
import {
  highlightOnlyPreviewMarkdownCode,
  renderOnlyPreviewMarkdown
} from '../../onlyPreviewMarkdown.service';
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

/**
 * 先渲染,再上色 —— 与 Monaco 那一面**刻意相反**。
 *
 * `MonacoTextPreview` 等语法就位再建 model,因为那里屏幕上**全部**是代码,先无色后上色
 * 是整屏跳变。markdown 反过来:正文是主体,代码块是其中一部分,让整篇文档等一个语法加载
 * 才显示是更差的取舍。所以这里立刻显示 `result.html`(占位符本身就是可用的纯代码块),
 * 颜色随后到达,只有代码块那几块会变。
 *
 * 代次围栏:切文件会连续触发,而上色是异步的 —— 没有它,后到的那次可能被先发的那次覆盖。
 */
const documentHtml = ref('');
let highlightGeneration = 0;

watch(
  renderResult,
  (result) => {
    const generation = ++highlightGeneration;
    if (!result.ok) {
      documentHtml.value = '';
      return;
    }
    documentHtml.value = result.html;
    if (result.codeBlocks.length === 0) return;
    void highlightOnlyPreviewMarkdownCode(result.html, result.codeBlocks).then((decorated) => {
      if (generation !== highlightGeneration) return;
      documentHtml.value = decorated;
    });
  },
  { immediate: true }
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
