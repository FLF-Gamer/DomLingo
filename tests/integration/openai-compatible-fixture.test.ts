import { describe, expect, it, vi } from 'vitest';

import { testOpenAICompatibleConnection } from '../../src/providers/openai-compatible';

const endpoint = 'http://127.0.0.1:11434/v1/chat/completions';

function createOllamaFixture(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const payload = JSON.parse(String(init?.body)) as { model?: string };

    expect(init?.method).toBe('POST');
    expect(headers.has('Authorization')).toBe(false);
    expect(payload.model).toBe('fixture-model');

    if (url.endsWith('/server-error')) {
      return new Response(JSON.stringify({ error: { message: 'fixture unavailable' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        id: 'fixture-completion',
        model: payload.model,
        choices: [{ message: { role: 'assistant', content: 'OK' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;
}

describe('OpenAI-compatible local service fixture', () => {
  it('connects to an Ollama-compatible loopback endpoint without an API key', async () => {
    await expect(
      testOpenAICompatibleConnection(
        {
          providerId: 'ollama',
          endpoint,
          model: 'fixture-model',
        },
        { fetchImpl: createOllamaFixture() },
      ),
    ).resolves.toBeUndefined();
  });

  it('maps errors returned by the local compatible service', async () => {
    await expect(
      testOpenAICompatibleConnection(
        {
          providerId: 'ollama',
          endpoint: endpoint.replace('/chat/completions', '/server-error'),
          model: 'fixture-model',
        },
        { fetchImpl: createOllamaFixture() },
      ),
    ).rejects.toMatchObject({ code: 'SERVER_ERROR' });
  });
});
