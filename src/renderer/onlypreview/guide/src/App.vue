<template>
  <div name="onlypreview__guideApp" class="onlypreview-guide">
    <main name="onlypreview__guideContent" class="onlypreview-guide__content">
      <p class="onlypreview-guide__eyebrow">{{ onlyPreviewI18n.guide.eyebrow }}</p>
      <h1>{{ onlyPreviewI18n.guide.title }}</h1>

      <div
        v-if="onlyPreviewGuideStore.info && onlyPreviewGuideStore.info.kind !== 'production'"
        name="onlypreview__guideTestWarning"
        class="onlypreview-guide__warning"
        role="alert"
      >
        <strong>{{ testInstanceTitle }}</strong>
        <span>{{ testInstanceGuide }}</span>
      </div>

      <section
        name="onlypreview__guideCompleteSetup"
        class="onlypreview-guide__copy-card"
      >
        <div class="onlypreview-guide__copy-card-heading">
          <div>
            <h2>{{ onlyPreviewI18n.guide.completeSetup }}</h2>
            <p>{{ onlyPreviewI18n.guide.completeSetupHint }}</p>
          </div>
          <a-button
            name="onlypreview__guideCopy"
            class="onlypreview-guide__copy-button"
            type="primary"
            size="mini"
            :title="onlyPreviewI18n.guide.copy"
            :aria-label="onlyPreviewI18n.guide.copy"
            :disabled="onlyPreviewGuideStore.status !== 'ready'"
            @click="onlyPreviewGuideStore.copyCompleteSetup()"
          >
            <template #icon><IconCopy :size="15" aria-hidden="true" /></template>
          </a-button>
        </div>

        <p
          v-if="onlyPreviewGuideStore.status === 'pending'"
          class="onlypreview-guide__status"
          role="status"
        >
          {{ onlyPreviewI18n.guide.pending }}
        </p>
        <div
          v-else-if="onlyPreviewGuideStore.status === 'restart-required'"
          class="onlypreview-guide__status onlypreview-guide__status--error"
          role="alert"
        >
          <strong>{{ restartRequiredTitle }}</strong>
          <span>{{ restartRequired }}</span>
        </div>
        <p
          v-else-if="onlyPreviewGuideStore.feedback"
          class="onlypreview-guide__status"
          :class="{
            'onlypreview-guide__status--error': onlyPreviewGuideStore.feedback === 'copy-failed'
          }"
          role="status"
        >
          {{ feedbackMessage }}
        </p>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watchEffect } from 'vue';
import { IconCopy } from '@tabler/icons-vue';
import { interpolateOnlyPreview } from '../../common/onlyPreviewFormat';
import { onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { onlyPreviewGuideStore } from './onlyPreviewGuide.store';

// 品牌名从 i18n 的 `appName` 注入,**文案里只有 `{app}`** —— 这样把这份渲染层搬到别的宿主时,
// re-vendor 不可能把上一个产品名再带回来(Ral 2026-09-10:cowork 里不该有 bitterless 品牌表达)。
const restartRequiredTitle = computed(() =>
  interpolateOnlyPreview(onlyPreviewI18n.guide.restartRequiredTitle, {
    app: onlyPreviewI18n.appName
  })
);

const restartRequired = computed(() =>
  interpolateOnlyPreview(onlyPreviewI18n.guide.restartRequired, {
    app: onlyPreviewI18n.appName
  })
);

const testInstanceTitle = computed(() =>
  interpolateOnlyPreview(onlyPreviewI18n.guide.testInstanceTitle, {
    serverName: onlyPreviewGuideStore.info?.serverName || ''
  })
);

// 按 main 侧给的 `kind` 分支,**不按产品名字面量** —— 后者在搬到别的宿主之后永远不成立,
// 而且那是一处品牌泄漏(见 `OnlyPreviewAgentSkillGuideInfo.kind` 上的注释)。
const testInstanceGuide = computed(() =>
  onlyPreviewGuideStore.info?.kind === 'preview'
    ? onlyPreviewI18n.guide.previewChannelMountGuide
    : onlyPreviewI18n.guide.testInstanceWarning
);

const feedbackMessage = computed(() =>
  onlyPreviewGuideStore.feedback === 'copied'
    ? onlyPreviewI18n.guide.copied
    : onlyPreviewI18n.guide.copyFailed
);

onMounted(() => {
  void onlyPreviewGuideStore.initialize();
});

watchEffect(() => {
  document.title = onlyPreviewI18n.guide.title;
});
</script>

<style lang="less">
@import './App.less';
</style>
