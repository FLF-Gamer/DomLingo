import { PROVIDER_PRESET_IDS, type ProviderPresetId } from '../providers/types';
import {
  decryptCredential,
  encryptCredential,
  isDeviceEncryptedCredentialEnvelope,
  type DeviceEncryptedCredentialEnvelope,
} from './credential-crypto';
import { getOrCreateDeviceKey } from './device-key-store';

const LOCAL_SECRETS_KEY = 'domlingo.encryptedLocalSecrets';

interface EncryptedLocalSecrets {
  schemaVersion: 1;
  apiKeyByProvider: Partial<Record<ProviderPresetId, DeviceEncryptedCredentialEnvelope>>;
}

const EMPTY_LOCAL_SECRETS: EncryptedLocalSecrets = {
  schemaVersion: 1,
  apiKeyByProvider: {},
};

async function loadEncryptedLocalSecrets(): Promise<EncryptedLocalSecrets> {
  const result = await chrome.storage.local.get(LOCAL_SECRETS_KEY);
  const value: unknown = result[LOCAL_SECRETS_KEY];

  if (typeof value !== 'object' || value === null || !('schemaVersion' in value)) {
    return { ...EMPTY_LOCAL_SECRETS, apiKeyByProvider: {} };
  }

  const candidate = value as Partial<EncryptedLocalSecrets>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.apiKeyByProvider !== 'object' ||
    candidate.apiKeyByProvider === null
  ) {
    return { ...EMPTY_LOCAL_SECRETS, apiKeyByProvider: {} };
  }

  const apiKeyByProvider: EncryptedLocalSecrets['apiKeyByProvider'] = {};
  for (const providerId of PROVIDER_PRESET_IDS) {
    const envelope = candidate.apiKeyByProvider[providerId];
    if (isDeviceEncryptedCredentialEnvelope(envelope)) {
      apiKeyByProvider[providerId] = envelope;
    }
  }

  return { schemaVersion: 1, apiKeyByProvider };
}

async function saveEncryptedLocalSecrets(secrets: EncryptedLocalSecrets): Promise<void> {
  await chrome.storage.local.set({ [LOCAL_SECRETS_KEY]: secrets });
}

export async function hasEncryptedApiKey(providerId: ProviderPresetId): Promise<boolean> {
  const secrets = await loadEncryptedLocalSecrets();
  return Boolean(secrets.apiKeyByProvider[providerId]);
}

export async function loadEncryptedApiKey(providerId: ProviderPresetId): Promise<string> {
  const secrets = await loadEncryptedLocalSecrets();
  const envelope = secrets.apiKeyByProvider[providerId];
  if (!envelope) return '';

  const key = await getOrCreateDeviceKey();
  return decryptCredential(envelope, key);
}

export async function saveEncryptedApiKey(
  providerId: ProviderPresetId,
  apiKey: string,
): Promise<void> {
  const secrets = await loadEncryptedLocalSecrets();
  const nextKeys = { ...secrets.apiKeyByProvider };
  const normalizedApiKey = apiKey.trim();

  if (normalizedApiKey) {
    const key = await getOrCreateDeviceKey();
    nextKeys[providerId] = await encryptCredential(normalizedApiKey, key);
  } else {
    delete nextKeys[providerId];
  }

  await saveEncryptedLocalSecrets({ schemaVersion: 1, apiKeyByProvider: nextKeys });
}
