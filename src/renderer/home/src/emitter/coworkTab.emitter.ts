import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { CoachXpcContract } from '@maestro-shared/coach.api';

/**
 * The one Cowork-host call the shared Mini Apps grid makes.
 *
 * Narrowed to a single method on purpose: this grid is rendered in two hosts — the Bitterless Home
 * window and Maestro's bundled Home tab — and only the second one has a tab strip to open into. A
 * `Pick` keeps the rest of the Cowork surface out of a component that must also run where there is
 * no Cowork window at all.
 */
export const coworkTabEmitter =
  createXpcRendererEmitter<Pick<CoachXpcContract, 'openCompositeTab'>>('CoachXpcHandler');
