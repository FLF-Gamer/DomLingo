import { ProviderRequestError, mapProviderHttpStatus } from './provider-error';
import type { ProviderConfig } from './types';

interface TestConnectionOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function isChatCompletionResponse(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('choices' in value)) return false;
  return Array.isArray(value.choices) && value.choices.length > 0;
}

export async function testOpenAICompatibleConnection(
  config: ProviderConfig,
  options: TestConnectionOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);

  try {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (config.apiKey) headers.set('Authorization', `Bearer ${config.apiKey}`);

    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 8,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new ProviderRequestError(mapProviderHttpStatus(response.status));

    const payload: unknown = await response.json();
    if (!isChatCompletionResponse(payload)) throw new ProviderRequestError('INVALID_RESPONSE');
  } catch (error: unknown) {
    if (error instanceof ProviderRequestError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ProviderRequestError('REQUEST_TIMEOUT');
    }
    throw new ProviderRequestError('NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
  }
}
