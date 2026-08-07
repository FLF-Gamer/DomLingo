import type { ProviderPresetId } from '../providers/types';
import {
  hasEncryptedApiKey,
  loadEncryptedApiKey,
  saveEncryptedApiKey,
} from './encrypted-secret-store';
import { getSessionApiKey, setSessionApiKey } from './session-secret-store';

export async function hasSavedApiKey(providerId: ProviderPresetId): Promise<boolean> {
  return hasEncryptedApiKey(providerId);
}

export async function getApiKey(providerId: ProviderPresetId): Promise<string> {
  const sessionApiKey = await getSessionApiKey(providerId);
  if (sessionApiKey) return sessionApiKey;

  const encryptedApiKey = await loadEncryptedApiKey(providerId);
  if (encryptedApiKey) await setSessionApiKey(providerId, encryptedApiKey);
  return encryptedApiKey;
}

export async function saveApiKey(providerId: ProviderPresetId, apiKey: string): Promise<void> {
  const normalizedApiKey = apiKey.trim();
  await saveEncryptedApiKey(providerId, normalizedApiKey);
  await setSessionApiKey(providerId, normalizedApiKey);
}

export async function clearApiKey(providerId: ProviderPresetId): Promise<void> {
  await saveEncryptedApiKey(providerId, '');
  await setSessionApiKey(providerId, '');
}
