import { describe, expect, it, vi } from 'vitest';

import {
  testOpenAICompatibleConnection,
  translateOpenAICompatible,
} from '../../src/providers/openai-compatible';

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

describe('translateOpenAICompatible', () => {
  const blocks = [
    {
      id: 'block-1',
      context: 'A greeting shown in an article.',
      segments: [{ id: 'source-1', text: 'Hello world.' }],
    },
  ];

  it('sends protected translation instructions and validates the model JSON', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.messages[0]?.role).toBe('system');
      expect(body.messages[0]?.content).toContain('untrusted data');
      expect(JSON.parse(body.messages[1]!.content)).toMatchObject({
        targetLanguage: 'zh-CN',
        blocks,
      });

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  translations: [{ id: 'source-1', text: '你好，世界。' }],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    await expect(
      translateOpenAICompatible(config, blocks, 'zh-CN', '', { fetchImpl }),
    ).resolves.toEqual({
      translations: [{ id: 'source-1', text: '你好，世界。' }],
      failedIds: [],
      failures: [],
    });
  });

  it('maps a non-JSON HTTP success body to an invalid provider response', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('not-json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    ) as typeof fetch;

    await expect(
      translateOpenAICompatible(config, blocks, 'zh-CN', '', { fetchImpl }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('requests one format repair when the model output is not parseable JSON', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const repairing = request.messages.at(-1)?.content.includes('could not be parsed') ?? false;
      const content = repairing
        ? JSON.stringify({ translations: [{ id: 'source-1', text: '修复后的译文。' }] })
        : 'This response is not JSON.';
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    await expect(
      translateOpenAICompatible(config, blocks, 'zh-CN', '', { fetchImpl }),
    ).resolves.toMatchObject({
      translations: [{ id: 'source-1', text: '修复后的译文。' }],
      failures: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops after one format repair when the repaired output is still invalid', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'Still not JSON.' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as typeof fetch;

    await expect(
      translateOpenAICompatible(config, blocks, 'zh-CN', '', { fetchImpl }),
    ).resolves.toMatchObject({
      translations: [],
      failures: [{ id: 'source-1', reason: 'INVALID_RESPONSE' }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
