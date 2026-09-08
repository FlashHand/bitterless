import type { OnlyPreviewErrorPayload } from './onlyPreview.types';
import type {
  OnlyPreviewSearchFailure,
  OnlyPreviewSearchFailureEvent
} from './onlyPreviewSearch.type';

// The runtime's error vocabulary is deliberately narrower than the content renderer's.
const ERROR_CODES = new Set([
  'INVALID_INPUT',
  'HOST_NOT_FOUND',
  'HOST_ROLE_DENIED',
  'WORKSPACE_NOT_FOUND',
  'WORKSPACE_ACCESS_DENIED',
  'PATH_NOT_FOUND',
  'PATH_PERMISSION_DENIED',
  'PATH_OUTSIDE_WORKSPACE',
  'PATH_NOT_REGULAR_FILE',
  'PATH_UNSUPPORTED_DEVICE',
  'TEXT_TOO_LARGE',
  'SIGNATURE_MISMATCH',
  'SETTINGS_INVALID',
  'INDEX_FAILED',
  'INDEX_PROTOCOL_ERROR',
  'OPERATION_FAILED',
  'PROTOCOL_ERROR'
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: string[]): boolean => {
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length &&
    ownKeys.every((key) => typeof key === 'string' && keys.includes(key));
};

const isToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= 256 && !value.includes('\0');

export const isOnlyPreviewSearchErrorPayload = (value: unknown): value is OnlyPreviewErrorPayload =>
  isRecord(value) &&
  hasExactKeys(value, ['code', 'message']) &&
  typeof value.code === 'string' && ERROR_CODES.has(value.code) &&
  typeof value.message === 'string' && value.message.length >= 1 && value.message.length <= 4_096 &&
  !value.message.includes('\0') && !value.message.includes('/') && !value.message.includes('\\');

export const isOnlyPreviewSearchFailure = (value: unknown): value is OnlyPreviewSearchFailure =>
  isRecord(value) &&
  hasExactKeys(value, ['workspaceId', 'generation', 'error']) &&
  isToken(value.workspaceId) && Number.isSafeInteger(value.generation) &&
  (value.generation as number) >= 0 && isOnlyPreviewSearchErrorPayload(value.error);

export const isOnlyPreviewSearchFailureEvent = (value: unknown): value is OnlyPreviewSearchFailureEvent =>
  isRecord(value) && hasExactKeys(value, ['hostId', 'failure']) &&
  isToken(value.hostId) && isOnlyPreviewSearchFailure(value.failure);
