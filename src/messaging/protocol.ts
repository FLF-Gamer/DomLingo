import {
  PROVIDER_PRESET_IDS,
  type PublicProviderConfig,
  type ProviderErrorCode,
  type ProviderTestResponse,
} from '../providers/types';
import type { TranslationBatchPayload, TranslationBatchResult } from '../translation/types';

export interface TestProviderMessage {
  version: 1;
  type: 'TEST_PROVIDER';
  config: PublicProviderConfig;
}

export type PageTranslationState =
  'idle' | 'scanning' | 'translating' | 'completed' | 'stopped' | 'error';

export interface PageTranslationStatus {
  state: PageTranslationState;
  total: number;
  translated: number;
  failed: number;
  message: string;
}

export interface StartTranslationMessage {
  version: 1;
  type: 'START_TRANSLATION';
  tabId: number;
}

export interface StopTranslationMessage {
  version: 1;
  type: 'STOP_TRANSLATION';
  tabId: number;
}

export interface RestoreOriginalMessage {
  version: 1;
  type: 'RESTORE_ORIGINAL';
  tabId: number;
}

export interface GetTabStatusMessage {
  version: 1;
  type: 'GET_TAB_STATUS';
  tabId: number;
}

export type PopupControlMessage =
  StartTranslationMessage | StopTranslationMessage | RestoreOriginalMessage | GetTabStatusMessage;

export interface TranslateBatchMessage {
  version: 1;
  type: 'TRANSLATE_BATCH';
  payload: TranslationBatchPayload;
}

export interface CancelSessionMessage {
  version: 1;
  type: 'CANCEL_SESSION';
  sessionId: string;
}

export interface StartContentTranslationMessage {
  version: 1;
  type: 'CONTENT_START_TRANSLATION';
  options: {
    batchCharacterLimit: number;
    concurrency: number;
  };
}

export interface StopContentTranslationMessage {
  version: 1;
  type: 'CONTENT_STOP_TRANSLATION';
}

export interface RestoreContentOriginalMessage {
  version: 1;
  type: 'CONTENT_RESTORE_ORIGINAL';
}

export interface GetContentStatusMessage {
  version: 1;
  type: 'CONTENT_GET_STATUS';
}

export interface PingContentMessage {
  version: 1;
  type: 'CONTENT_PING';
}

export type ContentCommandMessage =
  | StartContentTranslationMessage
  | StopContentTranslationMessage
  | RestoreContentOriginalMessage
  | GetContentStatusMessage
  | PingContentMessage;

export type ExtensionMessage =
  TestProviderMessage | PopupControlMessage | TranslateBatchMessage | CancelSessionMessage;

export type TranslationControlResponse =
  | {
      ok: true;
      status: PageTranslationStatus;
      providerLabel: string;
      model: string;
    }
  | { ok: false; code: 'CONFIG_REQUIRED' | 'PAGE_UNAVAILABLE'; message: string };

export type TranslateBatchResponse =
  | { ok: true; result: TranslationBatchResult }
  | { ok: false; code: ProviderErrorCode | 'SESSION_CANCELLED'; message: string };

export type ExtensionResponse =
  ProviderTestResponse | TranslationControlResponse | TranslateBatchResponse;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isTestProviderMessage(value: unknown): value is TestProviderMessage {
  if (!isObject(value)) return false;
  const message = value as Partial<TestProviderMessage>;

  return (
    message.version === 1 &&
    message.type === 'TEST_PROVIDER' &&
    typeof message.config === 'object' &&
    message.config !== null &&
    typeof message.config.endpoint === 'string' &&
    typeof message.config.model === 'string' &&
    typeof message.config.providerId === 'string' &&
    PROVIDER_PRESET_IDS.some((providerId) => providerId === message.config?.providerId)
  );
}

export function isPopupControlMessage(value: unknown): value is PopupControlMessage {
  if (!isObject(value)) return false;
  return (
    value.version === 1 &&
    ['START_TRANSLATION', 'STOP_TRANSLATION', 'RESTORE_ORIGINAL', 'GET_TAB_STATUS'].includes(
      String(value.type),
    ) &&
    typeof value.tabId === 'number' &&
    Number.isInteger(value.tabId) &&
    value.tabId >= 0
  );
}

function isTranslationBatchPayload(value: unknown): value is TranslationBatchPayload {
  if (!isObject(value) || !Array.isArray(value.blocks)) return false;
  if (
    typeof value.requestId !== 'string' ||
    value.requestId.length === 0 ||
    value.requestId.length > 128 ||
    typeof value.sessionId !== 'string' ||
    value.sessionId.length === 0 ||
    value.sessionId.length > 128 ||
    typeof value.generation !== 'number' ||
    !Number.isInteger(value.generation) ||
    value.generation < 0 ||
    value.blocks.length === 0 ||
    value.blocks.length > 50
  ) {
    return false;
  }

  let totalCharacters = 0;
  let totalSegments = 0;
  for (const block of value.blocks) {
    if (
      !isObject(block) ||
      typeof block.id !== 'string' ||
      block.id.length === 0 ||
      block.id.length > 128 ||
      typeof block.context !== 'string' ||
      block.context.length > 2_000 ||
      !Array.isArray(block.segments) ||
      block.segments.length === 0
    ) {
      return false;
    }

    totalCharacters += block.context.length;
    for (const segment of block.segments) {
      if (
        !isObject(segment) ||
        typeof segment.id !== 'string' ||
        segment.id.length === 0 ||
        segment.id.length > 128 ||
        typeof segment.text !== 'string' ||
        segment.text.length === 0 ||
        segment.text.length > 20_000
      ) {
        return false;
      }
      totalSegments += 1;
      totalCharacters += segment.text.length;
    }
  }

  return totalSegments <= 250 && totalCharacters <= 25_000;
}

export function isTranslateBatchMessage(value: unknown): value is TranslateBatchMessage {
  return (
    isObject(value) &&
    value.version === 1 &&
    value.type === 'TRANSLATE_BATCH' &&
    isTranslationBatchPayload(value.payload)
  );
}

export function isCancelSessionMessage(value: unknown): value is CancelSessionMessage {
  return (
    isObject(value) &&
    value.version === 1 &&
    value.type === 'CANCEL_SESSION' &&
    typeof value.sessionId === 'string' &&
    value.sessionId.length > 0 &&
    value.sessionId.length <= 128
  );
}
