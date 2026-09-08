<template>
  <div ref="editorHostRef" name="onlypreview__monaco" class="onlypreview-monaco"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
// **API-only 入口,不是 barrel。** `monaco-editor` 的 barrel(`editor.main`)会额外导入
// `basic-languages/monaco.contribution`(全部 monarch 语法)以及 css/html/json/typescript
// 四个语言贡献 —— 后四个会**按需去取语言 worker**,而那四个 worker 已经不打包了
// (`electron.vite.config.ts` 的 `languageWorkers`,它们一个消费者都没有)。留着 barrel 的话,
// 打开一个 .ts 文件会让 Monaco 去取一个不存在的 worker —— 那就是把 12 MB 换成一串错误。
//
// 上色不受影响:2026-09-08 起由 shiki 的 TextMate 语法做,经 `@shikijs/monaco` 装进 Monaco。
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type {
  OnlyPreviewSettings,
  OnlyPreviewTextContent
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { countOnlyPreviewSelectionTexts } from '../../onlyPreviewCharacterCount.service';
import { onlyPreviewPreviewStore } from '../../onlyPreviewPreview.store';
import { onlyPreviewFindAdapterBridge } from '../../onlyPreviewFindAdapter.service';
import { createOnlyPreviewMonacoFindAdapter } from '../../onlyPreviewMonacoFind.service';
import {
  MONACO_PLAIN_FALLBACK_THEME,
  prepareMonacoHighlighting
} from '../../onlyPreviewMonacoHighlight.service';

const props = defineProps<{
  content: OnlyPreviewTextContent;
  language: string;
  reportingRevision: string;
  settings: OnlyPreviewSettings;
}>();
const emit = defineEmits<{ ready: [] }>();

const editorHostRef = ref<HTMLElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let model: monaco.editor.ITextModel | null = null;
let selectionDisposable: monaco.IDisposable | null = null;
let findAdapter: ReturnType<typeof createOnlyPreviewMonacoFindAdapter> | null = null;
let unregisterFindAdapter: (() => void) | null = null;
// `createEditor` 现在是异步的(要等 shiki 的语法),而两个 `watch` 与 `onMounted` 都能触发它。
// 没有这道围栏的话,await 期间到来的第二次调用会先建好编辑器,然后被第一次调用的后续代码覆盖
// —— 表现成「打开 B 文件却显示 A 的内容」。这不是理论风险:切一次文件就是连续两次触发。
let createGeneration = 0;

const disposeEditor = (): void => {
  selectionDisposable?.dispose();
  selectionDisposable = null;
  unregisterFindAdapter?.();
  unregisterFindAdapter = null;
  findAdapter?.dispose();
  findAdapter = null;
  onlyPreviewPreviewStore.reportCharacterCount(0, props.reportingRevision);
  editor?.dispose();
  model?.dispose();
  editor = null;
  model = null;
};

const createEditor = async (): Promise<void> => {
  if (!editorHostRef.value) return;
  const generation = ++createGeneration;
  disposeEditor();
  // 等语法**再**建 model,而不是先建后重新分词:后者会看到一次「白 → 有色」的跳变。
  // 超时(见 `prepareMonacoHighlighting`)退回 monarch,所以慢语法不会把预览卡住。
  const highlighting = await prepareMonacoHighlighting(monaco, props.language);
  // await 之后一切都要重新确认:这期间可能已经切了文件,或者组件已经卸载。
  if (generation !== createGeneration) return;
  const host = editorHostRef.value;
  if (!host) return;
  const modelUri = monaco.Uri.parse(
    `inmemory://onlypreview/${encodeURIComponent(props.content.workspaceId)}/${encodeURIComponent(props.content.relativePath)}`
  );
  model = monaco.editor.createModel(
    props.content.text,
    highlighting?.language ?? props.language ?? 'plaintext',
    modelUri
  );
  editor = monaco.editor.create(host, {
    model,
    readOnly: true,
    domReadOnly: true,
    readOnlyMessage: { value: onlyPreviewI18n.preview.editorReadOnly },
    ariaLabel: onlyPreviewI18n.preview.readOnly,
    automaticLayout: true,
    largeFileOptimizations: true,
    maxTokenizationLineLength: 20_000,
    stopRenderingLineAfter: 20_000,
    fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
    fontLigatures: false,
    fontSize: props.settings.editorFontSize,
    lineHeight: Math.round(props.settings.editorFontSize * 1.55),
    minimap: { enabled: false },
    wordWrap: props.settings.wordWrap ? 'on' : 'off',
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
      verticalSliderSize: 8,
      horizontalSliderSize: 8
    },
    renderValidationDecorations: 'off',
    overviewRulerBorder: false,
    overviewRulerLanes: 0,
    occurrencesHighlight: 'off',
    selectionHighlight: true,
    stickyScroll: { enabled: false },
    padding: { top: 10, bottom: 10 },
    theme: highlighting?.theme ?? MONACO_PLAIN_FALLBACK_THEME
  });
  selectionDisposable = editor.onDidChangeCursorSelection(() => {
    const currentEditor = editor;
    const currentModel = model;
    if (!currentEditor || !currentModel) return;
    const selectedTexts = (currentEditor.getSelections() || [])
      .filter((selection) => !selection.isEmpty())
      .map((selection) => currentModel.getValueInRange(selection));
    onlyPreviewPreviewStore.reportCharacterCount(
      countOnlyPreviewSelectionTexts(selectedTexts),
      props.reportingRevision
    );
  });
  const selectionRevision = Number(props.reportingRevision);
  if (Number.isSafeInteger(selectionRevision) && selectionRevision >= 0) {
    findAdapter = createOnlyPreviewMonacoFindAdapter(editor, model);
    unregisterFindAdapter = onlyPreviewFindAdapterBridge.register(
      'monaco',
      selectionRevision,
      findAdapter
    );
    emit('ready');
  }
  onlyPreviewPreviewStore.armCharacterCountReporting(props.reportingRevision);
};

watch(
  () => [
    props.content.workspaceId,
    props.content.relativePath,
    props.content.text,
    props.language,
    props.reportingRevision
  ],
  () => {
    void createEditor();
  }
);

watch(
  () => [props.settings.editorFontSize, props.settings.wordWrap],
  () => {
    editor?.updateOptions({
      fontSize: props.settings.editorFontSize,
      lineHeight: Math.round(props.settings.editorFontSize * 1.55),
      wordWrap: props.settings.wordWrap ? 'on' : 'off',
      readOnly: true,
      domReadOnly: true
    });
  }
);

onMounted(() => {
  void createEditor();
});
onBeforeUnmount(disposeEditor);
</script>

<style lang="less">
@import './MonacoTextPreview.less';
</style>
