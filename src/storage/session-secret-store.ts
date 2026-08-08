import type { ProviderPresetId } from '../providers/types';

const SESSION_SECRETS_KEY = 'domlingo.sessionSecrets';

interface SessionSecrets {
  schemaVersion: 1;
  apiKeyByProvider: Partial<Record<ProviderPresetId, string>>;
}

async function loadSessionSecrets(): Promise<SessionSecrets> {
  const result = await chrome.storage.session.get(SESSION_SECRETS_KEY);
  const value: unknown = result[SESSION_SECRETS_KEY];

  if (typeof value !== 'object' || value === null || !('schemaVersion' in value)) {
    return { schemaVersion: 1, apiKeyByProvider: {} };
  }

  const candidate = value as Partial<SessionSecrets>;
  if (candidate.schemaVersion !== 1 || typeof candidate.apiKeyByProvider !== 'object') {
    return { schemaVersion: 1, apiKeyByProvider: {} };
  }

  return {
    schemaVersion: 1,
    apiKeyByProvider: { ...candidate.apiKeyByProvider },
  };
}

export async function getSessionApiKey(providerId: ProviderPresetId): Promise<string> {
  const secrets = await loadSessionSecrets();
  return secrets.apiKeyByProvider[providerId] ?? '';
}

export async function setSessionApiKey(
  providerId: ProviderPresetId,
  apiKey: string,
): Promise<void> {
  const secrets = await loadSessionSecrets();
  const nextKeys = { ...secrets.apiKeyByProvider };

  if (apiKey.trim()) nextKeys[providerId] = apiKey.trim();
  else delete nextKeys[providerId];

  await chrome.storage.session.set({
    [SESSION_SECRETS_KEY]: { schemaVersion: 1, apiKeyByProvider: nextKeys },
  });
}
