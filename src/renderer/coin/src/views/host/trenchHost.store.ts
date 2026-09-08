import { reactive } from 'vue';
import type { TrenchHostContext } from '@shared/trench/trenchXpc.type';

export class TrenchHostStore {
  host: TrenchHostContext['host'] = window.trenchHost.host;
  platform = window.trenchHost.platform;
  canDock = false;
  pending = false;
  requesting = false;
  unavailable = false;
}

export const trenchHostStore = reactive(new TrenchHostStore());
