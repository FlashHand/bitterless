<template>
  <main name="trench__index" class="trench-index">
    <section name="trench__index__actions" class="trench-index__actions">
      <div class="trench-index__run-status" aria-live="polite">
        {{ runStatus }}
      </div>
    </section>

    <div
      v-if="store.commandError && !unavailable"
      class="trench-index__action-error"
      role="alert"
    >
      <span>{{ localizedError(store.commandError) }}</span>
      <a-button
        v-if="store.commandError.code === 'PROVIDER_UNAVAILABLE'"
        name="trench__index__configure-gmgn"
        size="mini"
        @click="trenchGmgnSettingsStore.open()"
      >{{ t('trench.gmgnSettings.configure') }}</a-button>
    </div>

    <div v-if="unavailable" class="trench-index__repository-error" role="alert">
      <span>{{ store.commandError ? localizedError(store.commandError) : t('trench.indexWorkspace.storageUnavailable') }}</span>
      <a-button name="trench__index__retry" size="mini" @click="store.refresh()">{{ t('trench.indexWorkspace.retry') }}</a-button>
    </div>

    <div
      v-else
      id="trench-index-chain-panel"
      name="trench__index__columns"
      class="trench-index__columns"
      :aria-label="t('trench.indexWorkspace.indexForChain', { chain: chainLabel(selectedChain) })"
      :class="`trench-index__columns--${selectedChain}`"
    >
      <section name="trench__index__targets" class="trench-index__column trench-index__targets">
        <header class="trench-index__column-header">
          <span>{{ t('trench.indexWorkspace.targetCasForChain', { chain: chainLabel(selectedChain) }) }}</span>
          <a-tooltip :content="t('trench.indexWorkspace.addCa')" mini>
            <IconBtn
              name="trench__index__add-ca"
              class="trench-index__add"
              size="mini"
              :disabled="running || unavailable || !snapshot || addState.pending || generatePending"
              :aria-label="t('trench.indexWorkspace.addCa')"
              @click="openAdd"
            ><IconPlus aria-hidden="true" /></IconBtn>
          </a-tooltip>
        </header>
        <div v-if="!activeProjection?.targets.length" class="trench-index__empty">
          <strong>{{ t('trench.indexWorkspace.emptyTargetTitle') }}</strong>
          <span>{{ t('trench.indexWorkspace.emptyTargetDescription') }}</span>
        </div>
        <div v-else class="trench-index__list">
          <article
            v-for="target in activeProjection?.targets"
            :key="target.targetId"
            name="trench__index__target-row"
            class="trench-index__target-row"
          >
            <div class="trench-index__identity-line">
              <strong :title="target.symbol || target.name || undefined">{{ target.symbol || target.name || t('trench.indexWorkspace.unknownToken') }}</strong>
              <span v-if="target.symbol && target.name" class="trench-index__token-name" :title="target.name">{{ target.name }}</span>
            </div>
            <button
              class="trench-index__address"
              type="button"
              :title="t('trench.indexWorkspace.copyAddress', { address: target.contractAddress })"
              :aria-label="t('trench.indexWorkspace.copyContractAddress', { address: target.contractAddress })"
              @click="copy(target.contractAddress)"
            >{{ target.contractAddress }}</button>
            <dl class="trench-index__metrics">
              <div><dt>{{ t('trench.indexWorkspace.currentMc') }}</dt><dd>{{ money(target.currentMarketCapUsd) }}</dd></div>
              <div><dt>{{ highestLabel(target.highestMarketCapKind) }}</dt><dd>{{ money(target.highestMarketCapUsd) }}</dd></div>
            </dl>
            <div class="trench-index__row-status" :class="`trench-index__row-status--${target.state}`">
              <span v-if="target.state === 'analyzing'">{{ t('trench.indexWorkspace.analyzing') }}</span>
              <span v-else-if="target.state === 'pending'">{{ t('trench.indexWorkspace.waitingFirstAnalysis') }}</span>
              <span v-else-if="target.errorCode" :title="target.errorMessage || undefined">{{ localizedError({ code: target.errorCode, message: target.errorMessage || '' }) }}</span>
              <span v-else-if="target.lastSuccessAt">{{ t('trench.indexWorkspace.updatedAt', { time: dateTime(target.lastSuccessAt) }) }}</span>
              <span v-else>{{ t('trench.indexWorkspace.waitingFirstAnalysis') }}</span>
            </div>
          </article>
        </div>
      </section>

      <section name="trench__index__wallets" class="trench-index__column trench-index__wallets">
        <header class="trench-index__column-header">
          <span>{{ t('trench.indexWorkspace.indexWalletsForChain', { chain: chainLabel(selectedChain) }) }}</span>
          <a-button
            name="trench__index__generate"
            class="trench-index__generate"
            size="mini"
            type="primary"
            :loading="generatePending || running"
            :disabled="running || unavailable || !activeProjection?.targets.length || addState.pending || generatePending"
            @click="generate"
          >
            <template #icon><IconRefresh aria-hidden="true" /></template>
            {{ t('trench.indexWorkspace.generate') }}
          </a-button>
        </header>
        <div v-if="running && !snapshot?.currentRun" class="trench-index__empty" aria-live="polite">
          <strong>{{ t('trench.indexWorkspace.firstRunTitle') }}</strong>
          <span>{{ t('trench.indexWorkspace.firstRunDescription') }}</span>
        </div>
        <div v-else-if="!activeProjection?.wallets.length" class="trench-index__empty">
          <strong>{{ t('trench.indexWorkspace.emptyIndexTitle') }}</strong>
          <span>{{ t('trench.indexWorkspace.emptyIndexDescription') }}</span>
        </div>
        <div v-else class="trench-index__list">
          <article
            v-for="wallet in activeProjection?.wallets"
            :key="wallet.walletId"
            name="trench__index__wallet-row"
            class="trench-index__wallet-row"
          >
            <span class="trench-index__rank">#{{ String(wallet.chainRank).padStart(3, '0') }}</span>
            <span
              v-if="wallet.avatarUrl"
              name="trench__index__wallet-avatar"
              class="trench-index__avatar"
              aria-hidden="true"
            >
              <span class="trench-index__avatar-fallback">{{ trenchWalletAvatarInitial(wallet.name, wallet.canonicalAddress) }}</span>
              <img
                v-if="hasTrenchWalletAvatarImage(wallet.avatarUrl, failedAvatarUrls)"
                name="trench__index__wallet-avatar-image"
                class="trench-index__avatar-image"
                :src="wallet.avatarUrl"
                alt=""
                referrerpolicy="no-referrer"
                @error="onAvatarError(wallet.avatarUrl)"
              />
            </span>
            <div class="trench-index__wallet-body">
              <div class="trench-index__identity-line">
                <strong v-if="wallet.name">{{ wallet.name }}</strong>
              </div>
              <button
                class="trench-index__address"
                type="button"
                :title="t('trench.indexWorkspace.copyAddress', { address: wallet.address })"
                :aria-label="t('trench.indexWorkspace.copyWalletAddress', { address: wallet.address })"
                @click="copy(wallet.address)"
              >{{ wallet.address }}</button>
              <div class="trench-index__wallet-profit">{{ t('trench.indexWorkspace.totalProfit', { value: money(wallet.totalProfitUsd) }) }}</div>
              <div class="trench-index__wallet-meta">
                {{ t('trench.indexWorkspace.walletSources', { count: wallet.sourceCaCount, rank: wallet.bestSourceRank }) }}
              </div>
              <p v-if="wallet.note" class="trench-index__note">{{ wallet.note }}</p>
            </div>
          </article>
        </div>
      </section>
    </div>

  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconPlus, IconRefresh } from '@tabler/icons-vue';
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue';
import type { TrenchChain } from '@shared/trench/trench.type';
import type { TrenchHighestMarketCapKind, TrenchIndexError } from '@shared/trench/trenchIndex.type';
import { trenchGmgnSettingsStore } from '../TrenchGmgnSettings/trenchGmgnSettings.runtime';
import { trenchIndexStore as store } from '../../views/index/trenchIndex.runtime';
import { trenchIndexAddStore as addState } from '../../views/index/trenchIndexAdd.store';
import {
  hasTrenchWalletAvatarImage,
  markTrenchWalletAvatarFailed,
  trenchWalletAvatarInitial,
} from './trenchIndexAvatar';

const props = defineProps<{
  selectedChain: TrenchChain;
}>();

const { locale, t } = useI18n();
const generatePending = ref(false);
const selectedChain = computed(() => props.selectedChain);
const failedAvatarUrls = ref<ReadonlySet<string>>(new Set());
const snapshot = computed(() => store.snapshot);
const activeProjection = computed(() => snapshot.value?.chainProjections
  .find(({ chain }) => chain === selectedChain.value));
const running = computed(() => snapshot.value?.jobState === 'running');
const unavailable = computed(() => store.phase === 'unavailable');
const runStatus = computed(() => {
  if (running.value) return t('trench.indexWorkspace.runningTargets', {
    count: snapshot.value?.activeRun?.targetCount ?? 0,
  });
  if (snapshot.value?.lastFailedRun &&
    (!snapshot.value.currentRun || snapshot.value.lastFailedRun.startedAt > snapshot.value.currentRun.startedAt)) {
    return t('trench.indexWorkspace.lastRunFailed', {
      time: dateTime(snapshot.value.lastFailedRun.completedAt),
    });
  }
  if (snapshot.value?.currentRun?.completedAt) {
    return t('trench.indexWorkspace.lastSuccessful', {
      time: dateTime(snapshot.value.currentRun.completedAt),
    });
  }
  return t('trench.indexWorkspace.noSuccessfulAnalysis');
});

const chainLabel = (value: TrenchChain): string => value === 'solana'
  ? 'SOL'
  : value === 'robinhood'
    ? 'RHC'
    : 'BSC';
const dateTime = (value: number | null): string => value
  ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
  : '—';
const money = (value: number | null): string => value === null
  ? '—'
  : new Intl.NumberFormat(locale.value, {
      style: 'currency',
      currency: 'USD',
      notation: Math.abs(value) >= 1_000_000 ? 'compact' : 'standard',
      maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    }).format(value);
const highestLabel = (kind: TrenchHighestMarketCapKind): string => ({
  'provider-ath': t('trench.indexWorkspace.highestMc'),
  'estimated-ath': t('trench.indexWorkspace.estimatedHighest'),
  observed: t('trench.indexWorkspace.highestObserved'),
  unavailable: t('trench.indexWorkspace.highestMc'),
})[kind];
const localizedError = (error: TrenchIndexError): string => t(
  `trench.indexWorkspace.errors.${error.code}`,
);
const copy = async (value: string): Promise<void> => {
  await navigator.clipboard.writeText(value);
};
const onAvatarError = (avatarUrl: string): void => {
  failedAvatarUrls.value = markTrenchWalletAvatarFailed(failedAvatarUrls.value, avatarUrl);
};
const openAdd = (): void => {
  addState.chain = selectedChain.value;
  addState.error = null;
  store.clearCommandError();
  addState.visible = true;
};
const generate = async (): Promise<void> => {
  if (generatePending.value || running.value || addState.pending || !activeProjection.value?.targets.length) return;
  generatePending.value = true;
  try {
    await store.reanalyze(selectedChain.value);
  } catch {
    store.commandError = { code: 'INTERNAL', message: 'Could not generate INDEX.' };
  } finally {
    generatePending.value = false;
  }
};
</script>

<style lang="less">
@import './TrenchIndexWorkspace.less';
</style>
