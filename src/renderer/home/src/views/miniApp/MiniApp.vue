<template>
  <div class="bl-full-container">
    <div name="miniApp__page" class="mini-app-page">
      <div name="miniApp__grid" class="mini-app-page__grid">
        <a-card
          v-for="app in miniApps"
          :key="app.id"
          :data-mini-app-id="app.id"
          name="miniApp__card"
          class="mini-app-page__card"
        >
          <template #title>
            <div name="miniApp__card__title" class="mini-app-page__card-title">
              <img :src="app.icon" :alt="app.name" class="mini-app-page__card-icon" />
              <span>{{ app.name }}</span>
            </div>
          </template>
          <div name="miniApp__card__content" class="mini-app-page__card-content">
            <p class="mini-app-page__card-subtitle">{{ app.subtitle }}</p>
          </div>
          <template #actions>
            <a-button
              type="primary"
              size="mini"
              :loading="openingAppIds.has(app.id)"
              :disabled="openingAppIds.has(app.id)"
              @click="openApp(app)"
            >
              {{ i18nHelper.miniApp.open }}
            </a-button>
          </template>
        </a-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Message } from '@arco-design/web-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { homeShellBridge } from '@renderer/common/homeShellBridge.client';
import { omniWindowEmitter } from '@/emitter/omniWindow.emitter';
import { maestroWindowEmitter } from '@/emitter/maestroWindow.emitter';
import { coinWindowEmitter } from '@/emitter/coinWindow.emitter';
import { eyesOnAgentsWindowEmitter } from '@/emitter/eyesOnAgentsWindow.emitter';
import { submodulesWindowEmitter } from '@/emitter/submodulesWindow.emitter';
import { onlyPreviewEmitter } from '@/emitter/onlyPreview.emitter';
import { coworkTabEmitter } from '@/emitter/coworkTab.emitter';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import { createMiniApps, type MiniApp } from './miniApps.constant';

const openingAppIds = ref(new Set<string>());

const openTodo = async () => {
  await homeShellBridge.openTodo();
};

const openOmniBrowser = async () => {
  const result = await omniWindowEmitter.openOmniWindow();
  if (!result?.opened) throw new Error('Omni Browser did not become ready');
  Message.success(
    i18nHelper.miniApp.opened.replace('{name}', i18nHelper.miniApp.omniBrowser.name),
  );
};

const openMaestro = async () => {
  await maestroWindowEmitter.openMaestroWindow();
};

const openCoin = async () => {
  await coinWindowEmitter.openCoinWindow();
};

const openEyesOnAgents = async () => {
  await eyesOnAgentsWindowEmitter.openEyesOnAgentsWindow();
};

/**
 * Which host this grid is rendered in.
 *
 * The same component serves the Bitterless Home window and Maestro's bundled Home tab. Only the
 * Cowork host has a tab strip to open a mini app into, and it is the router that knows — see
 * `localHome.router.ts`, which passes this the same way it already passes `showChatMenuControl`.
 */
const props = withDefaults(defineProps<{ host?: 'window' | 'cowork' }>(), { host: 'window' });

const openOnlyPreview = async () => {
  // Inside Cowork, OnlyPreview is a mini app in a tab; outside it, it owns a window. Only one
  // OnlyPreview content surface is live at a time, so either entry point brings the live one
  // forward rather than building a second.
  if (props.host === 'cowork') {
    await coworkTabEmitter.openCompositeTab({ id: 'onlypreview' });
    return;
  }
  unwrapOnlyPreviewResult(await onlyPreviewEmitter.openOnlyPreviewWindow());
};

const openSubmodules = async () => {
  await submodulesWindowEmitter.openSubmodulesWindow();
};

const openApp = async (app: MiniApp): Promise<void> => {
  if (openingAppIds.value.has(app.id)) return;
  openingAppIds.value.add(app.id);
  try {
    await app.action();
  } catch (err) {
    console.error(`[MiniApp] Failed to open ${app.id}:`, err);
    Message.error(i18nHelper.miniApp.openFailed.replace('{name}', app.name));
  } finally {
    openingAppIds.value.delete(app.id);
  }
};

const miniApps = computed(() =>
  createMiniApps(
    openTodo,
    openMaestro,
    openCoin,
    openEyesOnAgents,
    openOmniBrowser,
    openOnlyPreview,
    openSubmodules,
    i18nHelper,
  ),
);
</script>

<style lang="less">
@import './MiniApp.less';
</style>
