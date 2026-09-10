<template>
  <a-modal
    :visible="eyesOnAgentsStore.threadSearchVisible"
    :title="i18nHelper.eyesOnAgents.search.title"
    :footer="false"
    :mask-closable="true"
    :unmount-on-close="false"
    width="min(560px, calc(100vw - 32px))"
    popup-container=".eyes-on-agents__main"
    modal-class="thread-search-modal"
    body-class="thread-search-modal__body"
    @cancel="closeThreadSearch"
    @open="handleModalOpen"
  >
    <section
      id="eyes-on-agents-thread- search-dialog"
      name="eyesOnAgents__threadSearch"
      class="thread-search"
      role="search"
    >
      <div
        name="eyesOnAgents__threadSearch__inputRegion"
        class="thread-search__input-region"
      >
        <div
          name="eyesOnAgents__threadSearch__field"
          class="thread-search__field"
        >
          <IconSearch class="thread-search__search-icon" :size="13" aria-hidden="true" />
          <input
            :key="`${eyesOnAgentsStore.threadSearchRevision}:${inputResetRevision}`"
            ref="inputRef"
            v-model="titleDraft"
            v-bind="inputAttributes"
            name="eyesOnAgents__threadSearch__input"
            class="thread-search__input"
            type="text"
            autocomplete="off"
            :placeholder="i18nHelper.eyesOnAgents.search.placeholder"
            @input.capture="ignoreStaleInput"
            @compositionstart="handleCompositionStart"
            @compositionend="handleCompositionEnd"
            @keydown="handleKeydown"
          />
          <IconBtn
            v-if="titleDraft || isComposing"
            name="eyesOnAgents__threadSearch__clear"
            class="thread-search__clear"
            :aria-label="i18nHelper.submodules.actions.clearSearch"
            :title="i18nHelper.submodules.actions.clearSearch"
            @mousedown.prevent
            @click="handleQueryClear"
          >
            <IconX :size="12" aria-hidden="true" />
          </IconBtn>
        </div>
      </div>

      <div
        :id="RESULT_LIST_ID"
        ref="resultsRef"
        name="eyesOnAgents__threadSearch__results"
        class="thread-search__results"
        role="listbox"
        :aria-label="i18nHelper.eyesOnAgents.search.results"
      >
        <div
          v-for="thread in eyesOnAgentsStore.threadSearchResults"
          :id="threadSearchOptionId(thread.sessionKey)"
          :key="thread.sessionKey"
          name="eyesOnAgents__threadSearch__result"
          class="thread-search__result"
          :class="{
            'thread-search__result--selected':
              thread.sessionKey === eyesOnAgentsStore.threadSearchSelectedSessionKey,
          }"
          role="option"
          :aria-selected="
            thread.sessionKey === eyesOnAgentsStore.threadSearchSelectedSessionKey
          "
          @mousedown.prevent
          @click.capture="eyesOnAgentsStore.selectThreadSearchResult(thread.sessionKey)"
        >
          <ThreadCard :thread="thread" />
        </div>

        <div
          v-if="eyesOnAgentsStore.threadSearchResults.length === 0"
          name="eyesOnAgents__threadSearch__empty"
          class="thread-search__empty"
          role="status"
        >
          {{ emptyMessage }}
        </div>
      </div>
    </section>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch, type InputHTMLAttributes } from 'vue';
import { IconSearch, IconX } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import ThreadCard from '../ThreadCard/ThreadCard.vue';
import { eyesOnAgentsStore } from '../../store/eyesOnAgents.store';

const RESULT_LIST_ID = 'eyes-on-agents-thread-search-results';
const inputRef = ref<HTMLInputElement | null>(null);
const resultsRef = ref<HTMLElement | null>(null);
const inputResetRevision = ref(0);
const isComposing = ref(false);
let invalidatedInput: HTMLInputElement | null = null;

const titleDraft = computed({
  get: () => eyesOnAgentsStore.titleDraft,
  set: (value: string) => {
    eyesOnAgentsStore.setTitleDraft(value);
  },
});

const threadSearchOptionId = (sessionKey: string): string =>
  `eyes-on-agents-thread-search-option-${encodeURIComponent(sessionKey)}`;

const selectedOptionId = computed(() => {
  const sessionKey = eyesOnAgentsStore.threadSearchSelectedSessionKey;
  return sessionKey ? threadSearchOptionId(sessionKey) : undefined;
});

const inputAttributes = computed<InputHTMLAttributes>(() => ({
  autofocus: true,
  role: 'combobox',
  'aria-label': i18nHelper.eyesOnAgents.search.placeholder,
  'aria-autocomplete': 'list',
  'aria-controls': RESULT_LIST_ID,
  'aria-expanded': eyesOnAgentsStore.threadSearchVisible,
  'aria-activedescendant': selectedOptionId.value,
}));

const emptyMessage = computed(() =>
  eyesOnAgentsStore.hasThreadSearchQueryTokens
    ? i18nHelper.eyesOnAgents.search.empty
    : i18nHelper.eyesOnAgents.search.startTyping);

const focusInput = async (
  lifecycleRevision = eyesOnAgentsStore.threadSearchRevision,
): Promise<void> => {
  await nextTick();
  if (
    !eyesOnAgentsStore.threadSearchVisible
    || lifecycleRevision !== eyesOnAgentsStore.threadSearchRevision
  ) return;
  inputRef.value?.focus?.();
};

const scrollSelectedResultIntoView = async (): Promise<void> => {
  await nextTick();
  if (!selectedOptionId.value || !resultsRef.value) return;
  resultsRef.value
    .querySelector<HTMLElement>('.thread-search__result--selected')
    ?.scrollIntoView({ block: 'nearest' });
};

const closeThreadSearch = (): void => {
  eyesOnAgentsStore.closeThreadSearch();
};

const handleModalOpen = (): void => {
  void focusInput(eyesOnAgentsStore.threadSearchRevision);
  void scrollSelectedResultIntoView();
};

const isCurrentInput = (event: Event): boolean =>
  eyesOnAgentsStore.threadSearchVisible
  && event.currentTarget === inputRef.value
  && event.currentTarget !== invalidatedInput;

const ignoreStaleInput = (event: Event): void => {
  // A detached native input can still receive its IME's final input event.
  if (!isCurrentInput(event)) event.stopImmediatePropagation();
};

const handleCompositionStart = (event: CompositionEvent): void => {
  if (isCurrentInput(event)) isComposing.value = true;
};

const handleCompositionEnd = (event: CompositionEvent): void => {
  if (isCurrentInput(event)) isComposing.value = false;
};

const invalidateInput = (): void => {
  invalidatedInput = inputRef.value;
  isComposing.value = false;
};

const handleQueryClear = (): void => {
  invalidateInput();
  inputResetRevision.value += 1;
  eyesOnAgentsStore.clearTitleQuery();
  void focusInput();
};

const openSelectedResult = async (): Promise<void> => {
  await eyesOnAgentsStore.openSelectedThreadSearchResult().catch(() => undefined);
};

const handleKeydown = (event: KeyboardEvent): void => {
  if (!isCurrentInput(event)) return;
  if (event.isComposing || isComposing.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
      event.stopPropagation();
    }
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    event.stopPropagation();
    eyesOnAgentsStore.moveThreadSearchSelection(1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopPropagation();
    eyesOnAgentsStore.moveThreadSearchSelection(-1);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    void openSelectedResult();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeThreadSearch();
  }
};

watch(
  () => eyesOnAgentsStore.threadSearchRevision,
  invalidateInput,
  { flush: 'sync' },
);

watch(
  () => eyesOnAgentsStore.threadSearchRevision,
  (revision) => {
    void focusInput(revision);
  },
  { flush: 'post' },
);

watch(
  () => eyesOnAgentsStore.threadSearchSelectedSessionKey,
  () => {
    void scrollSelectedResultIntoView();
  },
);
</script>

<style lang="less">
@import './ThreadSearch.less';
</style>
