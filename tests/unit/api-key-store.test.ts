import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/storage/device-key-store', () => ({
  getOrCreateDeviceKey: vi.fn(),
}));

import {
  clearApiKey,
  getApiKey,
  hasSavedApiKey,
  saveApiKey,
} from '../../src/storage/api-key-store';
import { getOrCreateDeviceKey } from '../../src/storage/device-key-store';

const localState: Record<string, unknown> = {};
const sessionState: Record<string, unknown> = {};

function createStorageArea(state: Record<string, unknown>) {
  return {
    get: vi.fn(async (key: string) => ({ [key]: state[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(state, items);
    }),
  };
}

describe('API key store', () => {
  beforeEach(async () => {
    for (const key of Object.keys(localState)) delete localState[key];
    for (const key of Object.keys(sessionState)) delete sessionState[key];

    vi.stubGlobal('chrome', {
      storage: {
        local: createStorageArea(localState),
        session: createStorageArea(sessionState),
      },
    });

    vi.mocked(getOrCreateDeviceKey).mockResolvedValue(
      await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('persists ciphertext locally and restores plaintext into a new session', async () => {
    await saveApiKey('openai', 'test-secret-value');

    expect(JSON.stringify(localState)).not.toContain('test-secret-value');
    await expect(hasSavedApiKey('openai')).resolves.toBe(true);

    for (const key of Object.keys(sessionState)) delete sessionState[key];
    await expect(getApiKey('openai')).resolves.toBe('test-secret-value');
    expect(JSON.stringify(sessionState)).toContain('test-secret-value');
  });

  it('clears both the encrypted copy and trusted session plaintext', async () => {
    await saveApiKey('openai', 'test-secret-value');
    await clearApiKey('openai');

    await expect(hasSavedApiKey('openai')).resolves.toBe(false);
    await expect(getApiKey('openai')).resolves.toBe('');
    expect(JSON.stringify(localState)).not.toContain('test-secret-value');
    expect(JSON.stringify(sessionState)).not.toContain('test-secret-value');
  });
});
