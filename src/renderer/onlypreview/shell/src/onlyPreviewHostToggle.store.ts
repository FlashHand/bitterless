import {
  OnlyPreviewContractError,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewHostToggleState } from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { describeOnlyPreviewError } from './onlyPreviewErrorDetail.store';
import type { OnlyPreviewShellStore } from './onlyPreviewShell.store';

export class OnlyPreviewHostToggleStore {
  state: OnlyPreviewHostToggleState = { canDock: false, pending: false };
  private generation = 0;
  private requestPending = false;

  get disabled(): boolean {
    return (
      !onlyPreviewEnv.hostToken ||
      this.requestPending ||
      this.state.pending ||
      (onlyPreviewEnv.host !== 'cowork' && !this.state.canDock)
    );
  }

  async refresh(owner: Pick<OnlyPreviewShellStore, 'errorMessage'>): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    const generation = ++this.generation;
    try {
      const state = unwrapOnlyPreviewResult(
        await onlyPreviewClient.getHostToggleState({ hostToken })
      );
      if (generation !== this.generation) return;
      this.state = state;
      if (state.error) {
        owner.errorMessage = describeOnlyPreviewError(
          new OnlyPreviewContractError(state.error.code, state.error.message)
        );
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.state = { canDock: false, pending: false };
      owner.errorMessage = describeOnlyPreviewError(error);
    }
  }

  async toggle(owner: Pick<OnlyPreviewShellStore, 'errorMessage'>): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken || this.disabled) return;
    this.requestPending = true;
    this.generation += 1;
    try {
      unwrapOnlyPreviewResult(await onlyPreviewClient.toggleHost({ hostToken }));
    } catch (error) {
      owner.errorMessage = describeOnlyPreviewError(error);
    } finally {
      await this.refresh(owner);
      this.requestPending = false;
    }
  }
}
