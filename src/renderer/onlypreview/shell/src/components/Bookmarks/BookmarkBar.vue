<template>
  <nav
    v-if="onlyPreviewShellStore.workspace"
    name="onlypreview__bookmarks"
    class="onlypreview-bookmarks"
    :aria-label="onlyPreviewI18n.bookmarks.label"
  >
    <IconBookmark class="onlypreview-bookmarks__mark" :size="14" aria-hidden="true" />
    <div name="onlypreview__bookmarkList" class="onlypreview-bookmarks__list">
      <button
        v-for="entry in onlyPreviewBookmarksStore.entries"
        :key="entry.relativePath"
        name="onlypreview__bookmark"
        class="onlypreview-bookmarks__item"
        type="button"
        :title="entry.relativePath"
        @click="onlyPreviewShellStore.openBookmark(entry)"
        @contextmenu.prevent.stop="onlyPreviewBookmarksStore.showMenu(entry.relativePath)"
        @keydown.shift.f10.prevent="onlyPreviewBookmarksStore.showMenu(entry.relativePath)"
      >
        <IconFolder v-if="entry.nodeKind === 'directory'" :size="15" aria-hidden="true" />
        <IconFile v-else :size="14" aria-hidden="true" />
        <span class="onlypreview-bookmarks__name">{{ entry.name }}</span>
      </button>
      <span
        v-if="!onlyPreviewBookmarksStore.entries.length && !onlyPreviewBookmarksStore.errorMessage"
        class="onlypreview-bookmarks__empty"
        >{{ onlyPreviewI18n.bookmarks.empty }}</span
      >
    </div>
    <button
      v-if="onlyPreviewBookmarksStore.errorMessage"
      class="onlypreview-bookmarks__error"
      name="onlypreview__bookmarksRetry"
      type="button"
      :title="onlyPreviewBookmarksStore.errorMessage"
      @click="onlyPreviewBookmarksStore.refresh()"
    >
      {{ onlyPreviewI18n.recents.retry }}
    </button>
  </nav>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { IconBookmark, IconFile, IconFolder } from '@tabler/icons-vue';
import { onlyPreviewI18n } from '../../../../common/onlyPreviewI18n';
import { onlyPreviewShellStore } from '../../onlyPreviewShell.store';
import { onlyPreviewBookmarksStore } from '../../onlyPreviewBookmarks.store';

watch(
  () => onlyPreviewShellStore.workspace?.workspaceId,
  () => onlyPreviewBookmarksStore.resetWorkspace()
);
onMounted(() => {
  onlyPreviewBookmarksStore.initialize();
});
onBeforeUnmount(() => {
  onlyPreviewBookmarksStore.dispose();
});
</script>

<style lang="less">
@import './BookmarkBar.less';
</style>
