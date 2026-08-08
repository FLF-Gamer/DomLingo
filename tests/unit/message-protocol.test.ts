import { describe, expect, it } from 'vitest';

import { isTestProviderMessage } from '../../src/messaging/protocol';

describe('isTestProviderMessage', () => {
  it('accepts a valid provider test message', () => {
    expect(
      isTestProviderMessage({
        version: 1,
        type: 'TEST_PROVIDER',
        config: {
          providerId: 'ollama',
          endpoint: 'http://localhost:11434/v1/chat/completions',
          model: 'gpt-oss:20b',
        },
      }),
    ).toBe(true);
  });

  it('rejects unknown provider IDs', () => {
    expect(
      isTestProviderMessage({
        version: 1,
        type: 'TEST_PROVIDER',
        config: {
          providerId: 'attacker-controlled',
          endpoint: 'https://example.com',
          model: 'example',
        },
      }),
    ).toBe(false);
  });
});
