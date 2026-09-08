<script setup lang="ts">
import type { ShortcutStore } from './store/shortcut.store'
import './SlashMenu.less'

defineProps<{ store: ShortcutStore }>()
defineEmits<{ commit: []; select: [index: number] }>()
</script>

<template>
  <div v-if="store.open && store.matches.length" id="maestro-slash-menu" name="maestroSlash__menu" class="maestro-slash" role="listbox">
    <button
      v-for="(item, index) in store.matches"
      :id="`maestro-slash-${index}`"
      :key="item.name"
      name="maestroSlash__item"
      class="maestro-slash__item"
      :class="{ 'maestro-slash__item--active': index === store.activeIndex }"
      type="button"
      role="option"
      tabindex="-1"
      :aria-selected="index === store.activeIndex"
      :disabled="store.pending"
      @mousedown.prevent="$emit('select', index)"
      @click="$emit('commit')"
    >
      <span class="maestro-slash__name">{{ item.name }}</span>
      <span class="maestro-slash__hint">{{ item.hint }}</span>
    </button>
  </div>
</template>
