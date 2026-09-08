import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { describeOnlyPreviewError } from './onlyPreviewErrorDetail.store';
import { onlyPreviewShellStore } from './onlyPreviewShell.store';
import { onlyPreviewTreeSelection } from './onlyPreviewTreeSelection.store';

let pending = false;

// macOS labels Backspace as Delete. Keep this in Shell: native preview/editor shortcuts must
// never delete a stale Project selection while another renderer owns keyboard focus.
export const handleOnlyPreviewProjectDeleteShortcut = (
  event: KeyboardEvent,
  projectActive: boolean
): boolean => {
  if (
    !projectActive ||
    onlyPreviewEnv.platform !== 'darwin' ||
    !document.hasFocus() ||
    event.defaultPrevented ||
    event.isComposing ||
    !event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey ||
    (event.key !== 'Backspace' && event.key !== 'Delete')
  )
    return false;
  const target = event.target;
  if (
    !(target instanceof HTMLElement) ||
    target.isContentEditable ||
    target.closest(
      'input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])'
    )
  )
    return false;
  const hostToken = onlyPreviewEnv.hostToken;
  const workspaceId = onlyPreviewShellStore.workspace?.workspaceId;
  if (!hostToken || !workspaceId) return false;
  if (pending || event.repeat) {
    event.preventDefault();
    return true;
  }
  const selection = onlyPreviewTreeSelection.entries();
  if (!selection.length || selection.some((entry) => !entry.relativePath)) return false;
  event.preventDefault();
  pending = true;
  void onlyPreviewClient
    .requestProjectDelete({ hostToken, workspaceId, selection })
    .then(unwrapOnlyPreviewResult)
    .catch((error) => {
      if (workspaceId === onlyPreviewShellStore.workspace?.workspaceId) {
        onlyPreviewShellStore.errorMessage = describeOnlyPreviewError(error);
      }
    })
    .finally(() => {
      pending = false;
    });
  return true;
};
