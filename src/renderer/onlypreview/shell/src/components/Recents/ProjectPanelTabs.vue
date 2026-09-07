<template>
  <div
    name="onlypreview__projectTabs"
    class="onlypreview-project-tabs"
    role="tablist"
    :aria-label="onlyPreviewI18n.recents.panelLabel"
  >
    <button
      v-for="tab in tabs"
      :id="`onlypreview-tab-${tab.value}`"
      :key="tab.value"
      name="onlypreview__projectTab"
      class="onlypreview-project-tabs__tab"
      :class="{ 'onlypreview-project-tabs__tab--active': modelValue === tab.value }"
      type="button"
      role="tab"
      :aria-selected="modelValue === tab.value"
      :aria-controls="`onlypreview-panel-${tab.value}`"
      :tabindex="modelValue === tab.value ? 0 : -1"
      @click="emit('update:modelValue', tab.value)"
      @keydown="changeTab($event, tab.value)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick } from 'vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';

defineProps<{ modelValue: 'project' | 'recents' }>();
const emit = defineEmits<{ 'update:modelValue': [value: 'project' | 'recents'] }>();
const tabs = computed(() => [
  { value: 'project' as const, label: onlyPreviewI18n.project.label },
  { value: 'recents' as const, label: onlyPreviewI18n.recents.label }
]);
const changeTab = (event: KeyboardEvent, current: 'project' | 'recents'): void => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? 'project'
      : event.key === 'End'
        ? 'recents'
        : current === 'project'
          ? 'recents'
          : 'project';
  emit('update:modelValue', next);
  void nextTick(() => document.getElementById(`onlypreview-tab-${next}`)?.focus());
};
</script>

<style lang="less">
@import './Recents.less';
</style>
