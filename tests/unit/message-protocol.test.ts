import { describe, expect, it } from 'vitest';

import {
  isPopupControlMessage,
  isTestProviderMessage,
  isTranslateBatchMessage,
} from '../../src/messaging/protocol';

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

describe('translation message guards', () => {
  it('accepts bounded popup controls and translation batches', () => {
    expect(isPopupControlMessage({ version: 1, type: 'START_TRANSLATION', tabId: 12 })).toBe(true);
    expect(
      isTranslateBatchMessage({
        version: 1,
        type: 'TRANSLATE_BATCH',
        payload: {
          requestId: 'request-1',
          sessionId: 'session-1',
          generation: 1,
          blocks: [
            {
              id: 'block-1',
              context: 'Example context',
              segments: [{ id: 'source-1', text: 'Translate this sentence.' }],
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it('rejects invalid tab IDs and oversized untrusted page payloads', () => {
    expect(isPopupControlMessage({ version: 1, type: 'START_TRANSLATION', tabId: -1 })).toBe(false);
    expect(
      isTranslateBatchMessage({
        version: 1,
        type: 'TRANSLATE_BATCH',
        payload: {
          requestId: 'request-1',
          sessionId: 'session-1',
          generation: 1,
          blocks: [
            {
              id: 'block-1',
              context: '',
              segments: [{ id: 'source-1', text: 'x'.repeat(20_001) }],
            },
          ],
        },
      }),
    ).toBe(false);
  });
});
