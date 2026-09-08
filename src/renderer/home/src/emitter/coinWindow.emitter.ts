import { createXpcRendererEmitter } from 'electron-xpc/renderer';

import type { TrenchHostApi } from '@shared/trench/trenchHost.type';

export const coinWindowEmitter = createXpcRendererEmitter<Pick<TrenchHostApi, 'openCoinWindow' | 'openCoinTab'>>('CoinWindowHandler');
