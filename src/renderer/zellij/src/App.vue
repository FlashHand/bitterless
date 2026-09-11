<template>
  <div name="zellij__app" class="zellij">
    <header name="zellij__toolbar" class="zellij__toolbar">
      <div class="zellij__identity">
        <IconTerminal2 :size="20" />
        <h1>{{ i18nHelper.zellij.title }}</h1>
        <span role="status" class="zellij__status">{{ zellijStore.statusLabel }}</span>
      </div>
      <div class="zellij__actions">
        <label class="zellij__enable">
          <span>{{ i18nHelper.setting.terminal.enable }}</span>
          <a-switch
            size="small"
            :aria-label="i18nHelper.setting.terminal.enable"
            :model-value="zellijStore.snapshot?.enabled ?? false"
            :loading="zellijStore.toggling"
            :disabled="!zellijStore.snapshot"
            @change="(value) => zellijStore.setEnabled(value)"
          />
        </label>
        <a-button
          size="mini"
          type="primary"
          :loading="zellijStore.initializing"
          :disabled="!zellijStore.snapshot?.enabled"
          @click="zellijStore.initialize()"
        >
          {{ i18nHelper.zellij.initialize }}
        </a-button>
        <IconBtn
          class="zellij__settings-button"
          :aria-label="i18nHelper.zellij.settings"
          :title="i18nHelper.zellij.settings"
          @click="zellijStore.toggleSettings()"
        >
          <IconSettings :size="18" />
        </IconBtn>
      </div>
    </header>

    <section v-if="zellijStore.settingsOpen" name="zellij__settings" class="zellij__settings">
      <div class="zellij__shortcut-fields">
        <label class="zellij__field">
          <span>{{ i18nHelper.zellij.splitDown }}</span>
          <a-input
            v-model="zellijStore.draft.splitDown"
            size="small"
            :max-length="80"
            :aria-label="i18nHelper.zellij.splitDown"
          />
        </label>
        <label class="zellij__field">
          <span>{{ i18nHelper.zellij.splitRight }}</span>
          <a-input
            v-model="zellijStore.draft.splitRight"
            size="small"
            :max-length="80"
            :aria-label="i18nHelper.zellij.splitRight"
          />
        </label>
        <label class="zellij__field">
          <span>{{ i18nHelper.zellij.closePane }}</span>
          <a-input
            v-model="zellijStore.draft.closePane"
            size="small"
            :max-length="80"
            :aria-label="i18nHelper.zellij.closePane"
          />
        </label>
        <a-button
          size="mini"
          type="primary"
          :loading="zellijStore.saving"
          :disabled="zellijStore.loading"
          @click="zellijStore.save()"
          >{{ i18nHelper.zellij.save }}</a-button
        >
      </div>
      <p class="zellij__hint">{{ i18nHelper.zellij.shortcutsHint }}</p>
      <div class="zellij__directory">
        <span>{{ i18nHelper.zellij.configDirectory }}</span>
        <bdi>{{ zellijStore.snapshot?.configDirectory }}</bdi>
        <a-button size="mini" type="text" @click="zellijStore.copyDirectory()">{{
          i18nHelper.zellij.copy
        }}</a-button>
        <a-button size="mini" type="text" @click="zellijStore.openDirectory()">{{
          i18nHelper.zellij.open
        }}</a-button>
      </div>
    </section>

    <div v-if="zellijStore.errorMessage" class="zellij__error" role="alert">
      <span>{{ zellijStore.errorMessage }}</span>
      <a-button size="mini" type="text" @click="zellijStore.load()">{{
        i18nHelper.zellij.refresh
      }}</a-button>
    </div>

    <main ref="terminalRegion" name="zellij__terminal" class="zellij__terminal">
      <div
        v-if="zellijStore.snapshot?.status !== 'ready' || !zellijStore.snapshot.enabled"
        class="zellij__empty"
      >
        <IconTerminal2 :size="34" />
        <p>
          {{
            zellijStore.snapshot?.enabled
              ? i18nHelper.zellij.emptyEnabled
              : i18nHelper.zellij.emptyDisabled
          }}
        </p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { IconSettings, IconTerminal2 } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import { zellijStore } from './zellij.store';

const terminalRegion = ref<HTMLElement | null>(null);
let observer: ResizeObserver | null = null;
onMounted(async () => {
  observer = new ResizeObserver(() => {
    if (terminalRegion.value) void zellijStore.setBounds(terminalRegion.value);
  });
  if (terminalRegion.value) observer.observe(terminalRegion.value);
  await zellijStore.load();
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<style lang="less">
@import './App.less';
</style>
