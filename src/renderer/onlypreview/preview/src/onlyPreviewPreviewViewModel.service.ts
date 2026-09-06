import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewDescriptor,
  OnlyPreviewErrorCode,
  OnlyPreviewPreviewPresentation
} from '@shared/onlypreview/onlyPreview.types';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../common/onlyPreviewI18n';

export interface OnlyPreviewMetadataViewModel {
  variant: 'unsupported' | 'error';
  title: string;
  reason: string;
  name: string;
  type: string;
  size: number;
  modifiedAt: number;
}

export interface OnlyPreviewMetadataViewModelInput {
  descriptor: OnlyPreviewDescriptor | null;
  presentation: OnlyPreviewPreviewPresentation | null;
  descriptorErrorActive: boolean;
  errorCode: OnlyPreviewErrorCode | null;
  errorMessage: string;
  presentationError: string;
  descriptorType: string;
}

export const toOnlyPreviewRendererError = (
  error: unknown
): { code: OnlyPreviewErrorCode; message: string } => {
  const contractError = error instanceof OnlyPreviewContractError ? error : null;
  const code = contractError?.code || 'OPERATION_FAILED';
  return {
    code,
    message: contractError
      ? getOnlyPreviewErrorMessage(contractError.code)
      : onlyPreviewI18n.errors.OPERATION_FAILED
  };
};

export const buildOnlyPreviewMetadataViewModel = (
  input: OnlyPreviewMetadataViewModelInput
): OnlyPreviewMetadataViewModel | null => {
  const descriptor = input.descriptor;
  if (!descriptor || input.presentation?.surface !== 'vue') return null;
  const hasAnyError =
    input.errorCode !== null || input.errorMessage !== '' || input.presentationError !== '';
  const hasError = input.descriptorErrorActive && hasAnyError;
  if (hasAnyError && !hasError) return null;
  if (!hasError && input.presentation.adapterId !== 'unsupported') return null;
  const variant = hasError ? 'error' : 'unsupported';
  let reason = input.errorMessage || input.presentationError;
  if (!reason) {
    if (descriptor.unsupportedCategory === 'image-format') {
      reason = onlyPreviewI18n.preview.unsupportedImageBody;
    } else if (descriptor.unsupportedCategory === 'video-container') {
      reason = onlyPreviewI18n.preview.unsupportedVideoBody;
    } else {
      reason = onlyPreviewI18n.preview.unsupportedBody;
    }
  }
  return {
    variant,
    title:
      variant === 'error'
        ? onlyPreviewI18n.preview.failedTitle
        : onlyPreviewI18n.preview.unsupportedTitle,
    reason,
    name: descriptor.name,
    type: input.descriptorType,
    size: descriptor.size,
    modifiedAt: descriptor.modifiedAt
  };
};
