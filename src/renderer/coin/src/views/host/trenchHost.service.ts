import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import {
  TRENCH_HOST_CHANGED_EVENT,
  type TrenchHostApi,
  type TrenchHostState
} from '@shared/trench/trenchHost.type';
import { trenchHostStore as store } from './trenchHost.store';

const emitter = createXpcRendererEmitter<TrenchHostApi>('CoinWindowHandler');
const token = window.trenchHost.surfaceToken;
let initialized = false;
let revision = 0;

const applyState = (state: TrenchHostState): void => {
  store.host = state.host;
  store.canDock = state.canDock;
  store.pending = state.pending;
  store.unavailable = false;
};

export const refreshTrenchHost = async (): Promise<void> => {
  if (!token || store.host === 'omni') return;
  const request = ++revision;
  try {
    const state = await emitter.getHostState({ token });
    if (request === revision) applyState(state);
  } catch {
    if (request === revision) {
      store.canDock = false;
      store.unavailable = true;
    }
  }
};

export const initializeTrenchHost = (): void => {
  if (initialized || !token || store.host === 'omni') return;
  initialized = true;
  xpcRenderer.subscribe(TRENCH_HOST_CHANGED_EVENT, (payload) => {
    revision += 1;
    applyState(payload.params as TrenchHostState);
  });
  window.addEventListener('focus', () => {
    void refreshTrenchHost();
  });
  void refreshTrenchHost();
};

export const toggleTrenchHost = async (): Promise<void> => {
  if (!token || store.host === 'omni' || store.pending || store.requesting) return;
  store.requesting = true;
  try {
    await emitter.toggleHost({ token });
  } finally {
    store.requesting = false;
    await refreshTrenchHost();
  }
};
