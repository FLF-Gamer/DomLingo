import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SYNCED_SETTINGS,
  loadSyncedSettings,
  saveSyncedSettings,
} from '../../src/storage/settings-store';

const state: Record<string, unknown> = {};

describe('synced settings structured output capability', () => {
  beforeEach(() => {
    for (const key of Object.keys(state)) delete state[key];
    vi.stubGlobal('chrome', {
      storage: {
        sync: {
          get: vi.fn(async (key: string) => ({ [key]: state[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => Object.assign(state, items)),
        },
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('uses Prompt compatibility for settings saved before capability detection', async () => {
    state['domlingo.syncedSettings'] = {
      ...DEFAULT_SYNCED_SETTINGS,
      structuredOutputMode: undefined,
    };

    await expect(loadSyncedSettings()).resolves.toMatchObject({
      structuredOutputMode: 'prompt',
    });
  });

  it('persists a detected JSON Schema capability with ordinary synced settings', async () => {
    await saveSyncedSettings({
      ...DEFAULT_SYNCED_SETTINGS,
      providerId: 'openai',
      structuredOutputMode: 'json-schema',
    });

    await expect(loadSyncedSettings()).resolves.toMatchObject({
      providerId: 'openai',
      structuredOutputMode: 'json-schema',
    });
  });

  it('bounds concurrency and batch characters loaded from synced storage', async () => {
    state['domlingo.syncedSettings'] = {
      ...DEFAULT_SYNCED_SETTINGS,
      concurrency: 99,
      batchCharacterLimit: 99_999,
    };

    await expect(loadSyncedSettings()).resolves.toMatchObject({
      concurrency: 3,
      batchCharacterLimit: 8_000,
    });
  });
});
