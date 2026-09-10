<template>
  <a-modal
    v-model:visible="state.visible"
    modal-class="trench-index-add-modal"
    :title="t('trench.indexWorkspace.dialogTitle')"
    :ok-text="t('trench.indexWorkspace.saveCas')"
    :ok-loading="state.pending"
    :ok-button-props="{ disabled: running }"
    :cancel-button-props="{ disabled: state.pending }"
    :mask-closable="!state.pending"
    :esc-to-close="!state.pending"
    :closable="!state.pending"
    :on-before-ok="submit"
  >
    <div name="trench__index__add-dialog" class="trench-index-add">
      <a-radio-group
        v-model="state.chain"
        name="trench__index__ca-chain"
        type="button"
        :disabled="state.pending"
        :aria-label="t('trench.indexWorkspace.chain')"
        @change="state.error = null"
      >
        <a-radio value="solana">SOL</a-radio>
        <a-radio value="bsc">BSC</a-radio>
        <a-radio value="robinhood">RHC</a-radio>
      </a-radio-group>
      <label for="trench-index-ca-input">{{ t('trench.indexWorkspace.contractAddress') }}</label>
      <a-textarea
        id="trench-index-ca-input"
        ref="caInput"
        v-model="state.text"
        name="trench__index__ca-input"
        :placeholder="t('trench.indexWorkspace.caBatchPlaceholderForChain', { chain: chainLabel })"
        :disabled="state.pending"
        :auto-size="{ minRows: 5, maxRows: 10 }"
        @input="state.error = null"
      />
      <p v-if="partition.ignoredCount" class="trench-index-add__warning" role="status">
        {{
          t(
            partition.ignoredChain === 'solana'
              ? 'trench.indexWorkspace.ignoredSolana'
              : 'trench.indexWorkspace.ignoredBsc',
            { count: partition.ignoredCount }
          )
        }}
      </p>
      <div v-if="errorText" class="trench-index-add__error" role="alert">
        <span>{{ errorText }}</span>
        <a-button
          v-if="state.error === 'PROVIDER_UNAVAILABLE'"
          name="trench__index__dialog-configure-gmgn"
          size="mini"
          @click="trenchGmgnSettingsStore.open()"
          >{{ t('trench.gmgnSettings.configure') }}</a-button
        >
      </div>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { TRENCH_INDEX_MAX_TARGETS } from '@shared/trench/trenchIndex.type';
import { trenchIndexAddStore as state } from '../../views/index/trenchIndexAdd.store';
import { trenchIndexStore } from '../../views/index/trenchIndex.runtime';
import {
  buildTrenchIndexAddTargetInput,
  partitionTrenchIndexAddInput
} from '../../views/index/trenchIndexAddInput';
import { trenchGmgnSettingsStore } from '../TrenchGmgnSettings/trenchGmgnSettings.runtime';

const { t } = useI18n();
const caInput = ref<{ focus(): void } | null>(null);
const chainLabel = computed(() => ({ solana: 'SOL', bsc: 'BSC', robinhood: 'RHC' })[state.chain]);
const partition = computed(() => partitionTrenchIndexAddInput(state.text, state.chain));
const running = computed(() => trenchIndexStore.snapshot?.jobState === 'running');
const errorText = computed(() =>
  state.error === 'INVALID_INPUT'
    ? t('trench.indexWorkspace.addressBatchRequiredForChain', { chain: chainLabel.value })
    : state.error
      ? t(`trench.indexWorkspace.errors.${state.error}`)
      : null
);

watch(
  () => state.visible,
  async (visible) => {
    if (visible) {
      await nextTick();
      caInput.value?.focus();
    }
  }
);

const submit = async (done: (closed: boolean) => void): Promise<void> => {
  if (state.pending || running.value) {
    done(false);
    return;
  }
  const input = partition.value;
  if (
    input.enteredCount < 1 ||
    input.enteredCount > TRENCH_INDEX_MAX_TARGETS ||
    input.invalidCount ||
    !input.retained.length
  ) {
    state.error = 'INVALID_INPUT';
    done(false);
    caInput.value?.focus();
    return;
  }
  const payload = JSON.stringify([state.chain, input.retained]);
  if (payload !== state.requestPayload || !state.requestId) {
    state.requestId = window.crypto.randomUUID();
    state.requestPayload = payload;
  }
  const request = buildTrenchIndexAddTargetInput(input, state.chain, state.requestId);
  if (!request) {
    state.error = 'INVALID_INPUT';
    done(false);
    return;
  }
  state.pending = true;
  state.error = null;
  let accepted = false;
  try {
    accepted = await trenchIndexStore.addTarget(request);
    if (!accepted) state.error = trenchIndexStore.commandError?.code ?? 'INTERNAL';
  } catch {
    state.error = 'INTERNAL';
  } finally {
    state.pending = false;
  }
  if (accepted) {
    state.text = '';
    state.requestId = null;
    state.requestPayload = null;
  }
  done(accepted);
  if (!accepted) {
    await nextTick();
    caInput.value?.focus();
  }
};
</script>

<style lang="less">
@import './TrenchIndexAddDialog.less';
</style>
