import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import { onlyPreviewHostRegistry } from '@main/miniapps/onlypreview/onlyPreviewHost.registry';
import type {
  OnlyPreviewPreviewRegionRuntime,
  OnlyPreviewPreviewViewService
} from './onlyPreviewPreviewView.service';

type OnlyPreviewVueRuntimeProbe = Pick<
  OnlyPreviewPreviewViewService,
  'getVuePreviewView' | 'getVueRuntimeToken'
>;

/**
 * The caller's host must be the content host the running Preview Region belongs to.
 *
 * Liveness is asked of the mount, not of a window: the composite is carried by an
 * `OnlyPreviewMount`, and a host that is not a window has none to interrogate.
 */
export const requireOnlyPreviewPreviewRuntime = (
  hostToken: string,
  runtime: OnlyPreviewPreviewRegionRuntime | null
): OnlyPreviewPreviewRegionRuntime => {
  const host = onlyPreviewHostRegistry.require(hostToken, ['content']);
  if (
    !runtime ||
    runtime.host.hostToken !== host.hostToken ||
    runtime.host.kind !== 'standalone' ||
    !runtime.isHostLive()
  ) {
    throw new OnlyPreviewContractError(
      'HOST_ROLE_DENIED',
      'OnlyPreview request does not belong to the active Preview Region.'
    );
  }
  return runtime;
};

/** ...and the observation must come from the Vue runtime that is live right now. */
export const requireOnlyPreviewVueRuntime = (
  hostToken: string,
  previewRuntimeToken: string,
  runtime: OnlyPreviewPreviewRegionRuntime | null,
  viewService: OnlyPreviewVueRuntimeProbe
): void => {
  requireOnlyPreviewPreviewRuntime(hostToken, runtime);
  const vuePreviewView = viewService.getVuePreviewView();
  if (
    !vuePreviewView ||
    vuePreviewView.webContents.isDestroyed() ||
    previewRuntimeToken !== viewService.getVueRuntimeToken()
  ) {
    throw new OnlyPreviewContractError(
      'HOST_ROLE_DENIED',
      'Preview renderer observation belongs to an inactive Vue runtime.'
    );
  }
};
