import { reactive } from 'vue';
import type { TrenchChain } from '@shared/trench/trench.type';
import type { TrenchIndexError } from '@shared/trench/trenchIndex.type';

class TrenchIndexAddStore {
  visible = false;
  pending = false;
  chain: TrenchChain = 'solana';
  text = '';
  error: TrenchIndexError['code'] | null = null;
  requestId: string | null = null;
  requestPayload: string | null = null;
}

export const trenchIndexAddStore = reactive(new TrenchIndexAddStore());
