import { getProviderPreset } from '../providers/presets';
import {
  isStructuredOutputMode,
  type ProviderPresetId,
  type StructuredOutputMode,
} from '../providers/types';

const SETTINGS_KEY = 'domlingo.syncedSettings';

export interface SyncedSettings {
  schemaVersion: 1;
  providerId: ProviderPresetId;
  endpoint: string;
  model: string;
  structuredOutputMode: StructuredOutputMode;
  targetLanguage: 'zh-CN';
  customPrompt: string;
  promptVersion: '1';
  batchCharacterLimit: number;
  concurrency: number;
  dynamicTranslationEnabled: boolean;
  cacheEnabled: boolean;
  syncEncryptedCredential: boolean;
}

const defaultPreset = getProviderPreset('deepseek');

export const DEFAULT_SYNCED_SETTINGS: SyncedSettings = {
  schemaVersion: 1,
  providerId: defaultPreset.id,
  endpoint: defaultPreset.endpoint,
  model: defaultPreset.modelExample,
  structuredOutputMode: 'prompt',
  targetLanguage: 'zh-CN',
  customPrompt: '',
  promptVersion: '1',
  batchCharacterLimit: 4_000,
  concurrency: 3,
  dynamicTranslationEnabled: true,
  cacheEnabled: true,
  syncEncryptedCredential: false,
};

export async function loadSyncedSettings(): Promise<SyncedSettings> {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  const value: unknown = result[SETTINGS_KEY];

  if (typeof value !== 'object' || value === null || !('schemaVersion' in value)) {
    return { ...DEFAULT_SYNCED_SETTINGS };
  }

  const candidate = value as Partial<SyncedSettings>;
  if (candidate.schemaVersion !== 1) return { ...DEFAULT_SYNCED_SETTINGS };

  const concurrency = Number.isFinite(candidate.concurrency)
    ? Math.max(1, Math.min(3, Math.floor(candidate.concurrency!)))
    : DEFAULT_SYNCED_SETTINGS.concurrency;
  const batchCharacterLimit = Number.isFinite(candidate.batchCharacterLimit)
    ? Math.max(2_000, Math.min(8_000, Math.floor(candidate.batchCharacterLimit!)))
    : DEFAULT_SYNCED_SETTINGS.batchCharacterLimit;

  return {
    ...DEFAULT_SYNCED_SETTINGS,
    ...candidate,
    concurrency,
    batchCharacterLimit,
    structuredOutputMode: isStructuredOutputMode(candidate.structuredOutputMode)
      ? candidate.structuredOutputMode
      : DEFAULT_SYNCED_SETTINGS.structuredOutputMode,
    schemaVersion: 1,
  };
}

export async function saveSyncedSettings(settings: SyncedSettings): Promise<void> {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}
