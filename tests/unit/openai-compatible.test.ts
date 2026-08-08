import { describe, expect, it, vi } from 'vitest';

import { testOpenAICompatibleConnection } from '../../src/providers/openai-compatible';

const config = {
  providerId: 'custom' as const,
  endpoint: 'https://api.example.com/v1/chat/completions',
  model: 'example-model',
  apiKey: 'test-key',
};

describe('testOpenAICompatibleConnection', () => {
  it('sends a minimal authenticated chat completions request', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer test-key');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'example-model',
        stream: false,
      });

      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    await expect(testOpenAICompatibleConnection(config, { fetchImpl })).resolves.toBeUndefined();
  });

  it('maps authentication failures without exposing the provider response body', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('sensitive provider response', { status: 401 }),
    ) as typeof fetch;

    await expect(testOpenAICompatibleConnection(config, { fetchImpl })).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
      message: 'API Key 无效或没有访问权限，请检查模型服务配置。',
    });
  });

  it('rejects malformed success responses', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: 'unexpected' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as typeof fetch;

    await expect(testOpenAICompatibleConnection(config, { fetchImpl })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('returns a stable timeout error when the request is aborted', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    ) as typeof fetch;

    await expect(
      testOpenAICompatibleConnection(config, { fetchImpl, timeoutMs: 1 }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });
});
