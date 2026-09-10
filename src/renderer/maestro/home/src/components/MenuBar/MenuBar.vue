<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  IconArrowLeft,
  IconArrowRight,
  IconRefresh,
  IconCommon
} from '@arco-design/web-vue/es/icon'
import {
  IconCameraSpark,
  IconCircleFilled,
  IconLoader2,
  IconPlus,
  IconSettings,
  IconSparkles,
  IconSparklesFilled,
  IconX
} from '@tabler/icons-vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import type { TabInfo } from '@maestro-shared/coach.api'
import { MAESTRO_WORKBENCH_DISPLAY_URL } from '@maestro-shared/coach.api'
import IconBtn from '../../../../../common/components/IconBtn/IconBtn.vue'
import { menuBarStore } from './menuBar.store'
import { tabStore } from './tab.store'
import { updateStore } from '../../store/update.store'
import { layoutStore } from '../../store/layout.store'
import { captureStore } from '../../store/capture.store'
import { workbenchStore } from '../../store/workbench.store'
import './MenuBar.less'

// Shared style for the address-bar icon buttons: borderless,
// transparent, highlight on hover, soft scale-down on press; muted + no hover when disabled.
const navBtn = 'maestro-menu-bar__nav-button'
const addressValue = computed({
  get: () => workbenchStore.visible ? MAESTRO_WORKBENCH_DISPLAY_URL : menuBarStore.url,
  set: (value: string) => {
    if (!workbenchStore.visible) menuBarStore.url = value
  }
})
const workbenchChipAfterIndex = computed(() => {
  const lastPinned = tabStore.tabs.findLastIndex((tab) => tab.pinned)
  return Math.max(0, lastPinned)
})

function chipActive(tab: TabInfo): boolean {
  return tab.active && !workbenchStore.visible
}

async function onTabClick(id: string): Promise<void> {
  await workbenchStore.background()
  await tabStore.activate(id)
}
// The fixed Home tab is a bundled renderer, so its icon must be bundled too.
import bitterlessIcon from '@maestro-renderer/common/assets/icons/bitterless-icon.png'

// Handed to menuBarStore on mount — it is the address bar's controller, and the main process
// asks it to focus after the operator opens a blank tab.
const addressInput = ref<HTMLInputElement | null>(null)

onMounted(() => {
  menuBarStore.bindAddressInput(addressInput.value)
  menuBarStore.init()
  tabStore.init()
  updateStore.init()
  captureStore.init()
  layoutStore.init()
  void workbenchStore.init()
})

// Tab label: page <title> when known, else the URL host, else the localized new-tab label.
function tabLabel(tab: TabInfo): string {
  if (tab.kind === 'home') return i18nHelper.menuBar.maestro.homeTab
  if (tab.title?.trim()) return tab.title.trim()
  try {
    return new URL(tab.url).host || i18nHelper.menuBar.maestro.newTab
  } catch {
    return tab.url?.trim() || i18nHelper.menuBar.maestro.newTab
  }
}

// Favicons that errored / 404'd — fall back to the default icon instead of a broken image.
// Keyed by URL so a tab that later navigates to a page with a new favicon gets a fresh try.
const failedFavicons = reactive(new Set<string>())
function markFaviconFailed(url: string): void {
  if (url) failedFavicons.add(url)
}
// Icon to show: the fixed local Home tab's bundled icon, else the page favicon (if it loaded),
// else '' — meaning the template renders the default Arco icon.
function tabIconSrc(tab: TabInfo): string {
  if (tab.kind === 'home') return bitterlessIcon
  if (tab.favicon && !failedFavicons.has(tab.favicon)) return tab.favicon
  return ''
}

// Chrome-style "close several in a row": when a close control is clicked, freeze every tab's width to its
// current (uniform) value so closing a middle tab just shifts the rest left by exactly one tab
// — landing the next tab's close control right under the cursor. Cleared on mouseleave, when widths reflow.
const lockedTabWidth = ref<number | null>(null)
function onCloseClick(e: MouseEvent, id: string): void {
  const tabEl = (e.currentTarget as HTMLElement).parentElement
  if (tabEl) lockedTabWidth.value = tabEl.offsetWidth
  void tabStore.close(id)
}
function unlockTabWidths(): void {
  lockedTabWidth.value = null
}

// Tab chip classes. Fixed system tabs get persistent treatments so they never read as ordinary,
// closable browser tabs.
function tabClass(tab: TabInfo): string {
  if (tab.kind === 'home') {
    return chipActive(tab)
      ? 'maestro-menu-bar__tab--pinned-active'
      : 'maestro-menu-bar__tab--pinned'
  }
  return chipActive(tab)
    ? 'maestro-menu-bar__tab--active'
    : 'maestro-menu-bar__tab--idle'
}

function fixedTabClass(tab: TabInfo): string {
  if (tab.kind === 'home') return 'maestro-menu-bar__tab--pinned-size'
  return 'maestro-menu-bar__tab--browser-size'
}
</script>

<template>
  <!-- 78px top chrome = an Omni-derived 36px tab strip + the compact 42px address bar. The renderer-driven
       layout measures the body placeholders below this, so the native operation/
       control views sit at y=78 automatically. -->
  <div class="maestro-menu-bar">
    <!-- Tab strip (36px). One chip per open operation-view tab; new tabs appear when a
         page opens a new window. Click to switch, use the icon action to close. On macOS the left gutter
         clears the native traffic lights (hiddenInset). -->
    <div
      class="maestro-menu-bar__tabs"
      :class="{ 'maestro-menu-bar__tabs--mac': menuBarStore.isMac }"
      @mouseleave="unlockTabWidths"
    >
      <!-- Tabs COMPRESS to fit (no scroll): each shrinks toward its 48px min; when they
           can't shrink further, overflowing tabs are clipped (not shown). The new-tab
           button lives OUTSIDE this region so it stays visible no matter the tab count. -->
      <div class="maestro-menu-bar__tab-list">
        <template v-for="(tab, i) in tabStore.tabs" :key="tab.id">
          <div
            :title="tabLabel(tab)"
            :draggable="!tab.pinned"
            class="maestro-menu-bar__tab"
            :class="[
              tabClass(tab),
              // Fixed system tabs never shrink or drag; closable browser tabs compress to fit.
              fixedTabClass(tab),
              tabStore.isDragging(tab.id) ? 'maestro-menu-bar__tab--dragging' : ''
            ]"
            :style="!tab.pinned && lockedTabWidth ? { width: lockedTabWidth + 'px', flexShrink: 0 } : undefined"
            @click="onTabClick(tab.id)"
            @contextmenu.prevent="tabStore.showMenu(tab.id)"
            @dragstart="tabStore.startDrag($event, tab.id)"
            @dragover.prevent="tabStore.dragOver($event, tab.id)"
            @drop.prevent="tabStore.finishDrag()"
            @dragend="tabStore.finishDrag()"
          >
            <!-- The favicon slot is ALWAYS 16px — only the title text compresses. Loading swaps
                 the icon in place, so the chip never reflows. -->
            <IconLoader2
              v-if="tab.loading"
              :size="16"
              class="maestro-menu-bar__loading-icon"
              aria-hidden="true"
            />
            <img
              v-else-if="tabIconSrc(tab)"
              :src="tabIconSrc(tab)"
              alt=""
              class="maestro-menu-bar__favicon"
              @error="markFaviconFailed(tab.favicon)"
            />
            <IconCommon v-else class="maestro-menu-bar__fallback-icon" />
            <span class="maestro-menu-bar__tab-label" :class="{ 'maestro-menu-bar__tab-label--pinned': tab.pinned }">{{
              tabLabel(tab)
            }}</span>
            <!-- Close action (closable tabs only). Absolutely positioned so it never widens the tab
                 — a compressed tab keeps showing its favicon. Visible on hover, or always on
                 the active tab. The pinned local Home tab is non-closable, so it has none. -->
            <IconBtn
              v-if="!tab.pinned && tabStore.tabs.length > 1"
              class="maestro-menu-bar__tab-close"
              :class="{ 'maestro-menu-bar__tab-close--active': chipActive(tab) }"
              draggable="false"
              :title="i18nHelper.menuBar.maestro.closeTab"
              :aria-label="i18nHelper.menuBar.maestro.closeTab"
              @click.stop="onCloseClick($event, tab.id)"
              @dragstart.stop.prevent
            >
              <IconX :size="14" stroke="2" aria-hidden="true" />
            </IconBtn>
          </div>
          <template v-if="workbenchStore.open && i === workbenchChipAfterIndex">
            <div class="maestro-menu-bar__tab-divider-wrap" aria-hidden="true">
              <div class="maestro-menu-bar__tab-divider"></div>
            </div>
            <div
              name="menubar__workbench__tab"
              class="maestro-menu-bar__tab maestro-menu-bar__tab--workbench"
              :class="workbenchStore.visible ? 'maestro-menu-bar__tab--pinned-active' : 'maestro-menu-bar__tab--pinned'"
              :title="i18nHelper.maestroWorkbench.title"
              role="tab"
              :aria-selected="workbenchStore.visible"
              tabindex="0"
              @click="workbenchStore.openTab()"
              @keydown.enter.self.prevent="workbenchStore.openTab()"
              @keydown.space.self.prevent="workbenchStore.openTab()"
            >
              <IconSettings class="maestro-menu-bar__favicon" :size="16" stroke="1.8" />
              <span class="maestro-menu-bar__tab-label">{{ i18nHelper.menuBar.maestro.workbenchTab }}</span>
              <IconBtn
                name="menubar__workbench__close"
                class="maestro-menu-bar__tab-close"
                :class="{ 'maestro-menu-bar__tab-close--active': workbenchStore.visible }"
                :title="i18nHelper.maestroWorkbench.close"
                :aria-label="i18nHelper.maestroWorkbench.close"
                @click.stop="workbenchStore.close()"
              >
                <IconX :size="14" stroke="2" aria-hidden="true" />
              </IconBtn>
            </div>
          </template>
          <!-- Divider after the pinned group, before the first closable browsing tab. -->
          <div
            v-if="tab.pinned && tabStore.tabs[i + 1] && !tabStore.tabs[i + 1].pinned"
            class="maestro-menu-bar__tab-divider-wrap"
          >
            <div class="maestro-menu-bar__tab-divider"></div>
          </div>
        </template>
      </div>
      <!-- New-tab button — circular, vertically centered to the tab row, always visible.
           Opens a blank operation view (empty, editable address bar) ready for a URL. -->
      <div class="maestro-menu-bar__new-tab-wrap">
        <IconBtn
          class="maestro-menu-bar__new-tab"
          :title="i18nHelper.menuBar.maestro.newTab"
          :aria-label="i18nHelper.menuBar.maestro.newTab"
          @click="tabStore.newTab()"
        >
          <IconPlus :size="16" stroke="2" aria-hidden="true" />
        </IconBtn>
      </div>
      <!-- Agent-owned recording status. The fixed slot remains in the draggable tab strip so
           recording state cannot move the new-tab button. It is deliberately not interactive. -->
      <div
        name="menubar__capture__status"
        class="maestro-menu-bar__capture-status"
        role="status"
        :title="captureStore.recording ? i18nHelper.menuBar.maestro.recording : undefined"
        :aria-label="captureStore.recording ? i18nHelper.menuBar.maestro.recording : undefined"
      >
        <IconCircleFilled
          v-if="captureStore.recording"
          class="maestro-menu-bar__capture-status-icon"
          :size="14"
        />
      </div>
    </div>

    <!-- Address bar (42px). -->
    <header
      class="maestro-menu-bar__address-row"
    >
      <!-- Back / Forward / Reload, grouped in a subtle segmented cluster (data-slot="nav"). Back &
           Forward disable when there's no history that way; the pinned Home tab also disables
           history nav because its bundled local entry is fixed. -->
      <div data-slot="nav" class="maestro-menu-bar__navigation">
        <button
          :class="navBtn"
          :disabled="workbenchStore.visible || !menuBarStore.canGoBack"
          :title="i18nHelper.menuBar.maestro.back"
          :aria-label="i18nHelper.menuBar.maestro.back"
          type="button"
          @click="menuBarStore.back()"
        >
          <IconArrowLeft />
        </button>
        <button
          :class="navBtn"
          :disabled="workbenchStore.visible || !menuBarStore.canGoForward"
          :title="i18nHelper.menuBar.maestro.forward"
          :aria-label="i18nHelper.menuBar.maestro.forward"
          type="button"
          @click="menuBarStore.forward()"
        >
          <IconArrowRight />
        </button>
        <button
          :class="navBtn"
          :title="i18nHelper.menuBar.maestro.reload"
          :disabled="workbenchStore.visible"
          :aria-label="i18nHelper.menuBar.maestro.reload"
          type="button"
          @click="menuBarStore.reload()"
        >
          <IconRefresh />
        </button>
      </div>
      <!-- First-party fixed-purpose tabs expose a stable display address but cannot be
           navigated away from their trusted entry; ordinary browser tabs keep the normal
           schemeless/pasted-address behavior. -->
      <input
        ref="addressInput"
        v-model="addressValue"
        :disabled="workbenchStore.visible || tabStore.activeLocked"
        :title="workbenchStore.visible || tabStore.activeLocked ? i18nHelper.menuBar.maestro.fixedAddressLocked : ''"
        class="maestro-menu-bar__address"
        :placeholder="i18nHelper.menuBar.maestro.addressPlaceholder"
        @keydown.enter="menuBarStore.go()"
      />

      <!-- Trailing actions (data-slot="actions"): a hairline divider sets the cluster off from the
           address field, then Snapshot, panel, Workbench, and the conditional Update pill. -->
      <div data-slot="actions" class="maestro-menu-bar__actions">
        <div class="maestro-menu-bar__actions-divider" aria-hidden="true"></div>

        <!-- Snapshot — only while capturing. Captures the current page into the capture trace. -->
        <button
          v-if="captureStore.recording && captureStore.recordActions"
          class="maestro-menu-bar__snapshot"
          :class="{ 'maestro-menu-bar__snapshot--busy': captureStore.snapshotting }"
          :disabled="captureStore.snapshotting"
          :title="i18nHelper.menuBar.maestro.captureSnapshot"
          :aria-label="i18nHelper.menuBar.maestro.captureSnapshot"
          type="button"
          @click="captureStore.snapshot()"
        >
          <IconCameraSpark :size="18" stroke="1.8" />
        </button>

        <!-- Sidebar (right control/AI panel) toggle — collapses the panel and reflows the operation
             view to full width (see layout.store.ts + Layout.vue). Filled sparkles = panel shown. -->
        <button
          :class="[navBtn, { 'maestro-menu-bar__nav-button--active': layoutStore.sidebarOpen }]"
          :aria-pressed="layoutStore.sidebarOpen"
          :title="layoutStore.sidebarOpen ? i18nHelper.menuBar.maestro.hidePanel : i18nHelper.menuBar.maestro.showPanel"
          type="button"
          @click="layoutStore.toggleSidebar()"
        >
          <IconSparklesFilled v-if="layoutStore.sidebarOpen" :size="18" stroke="1.8" />
          <IconSparkles v-else :size="18" stroke="1.8" />
        </button>

        <button
          name="menubar__workbench__open"
          :class="navBtn"
          :title="i18nHelper.menuBar.maestro.showWorkbench"
          :aria-label="i18nHelper.menuBar.maestro.showWorkbench"
          type="button"
          @click="workbenchStore.openTab()"
        >
          <IconSettings :size="18" stroke="1.8" />
        </button>

        <!-- Update button — at the address bar's trailing edge. The compact label names the state
             it is in (Downloading / Update); the title preserves the target-version detail. -->
        <button
          v-if="updateStore.ready"
          class="maestro-menu-bar__update"
          :class="{ 'maestro-menu-bar__update--downloading': updateStore.downloading }"
          :disabled="updateStore.downloading"
          :title="
            updateStore.downloading
              ? updateStore.info
                ? i18nHelper.menuBar.maestro.downloadingVersion.replace('{version}', updateStore.info.version)
                : i18nHelper.menuBar.maestro.updating
              : updateStore.info
                ? i18nHelper.menuBar.updateToVersion.replace('{version}', updateStore.info.version)
                : i18nHelper.menuBar.maestro.update
          "
          type="button"
          @click="updateStore.install()"
        >
          <span class="maestro-menu-bar__update-label">{{
            updateStore.downloading
              ? i18nHelper.menuBar.downloadingUpdate
              : i18nHelper.menuBar.restartToUpdate
          }}</span>
        </button>
      </div>
    </header>
  </div>
</template>
