import { ProviderRequestError, mapProviderHttpStatus, parseRetryAfterMs } from './provider-error';
import type { ProviderConfig } from './types';
import { buildTranslationMessages, buildTranslationRepairMessages } from '../translation/prompt';
import { validateTranslationResponse } from '../translation/response-validator';
import type { TranslationBatchResult, TranslationBlock } from '../translation/types';

interface TestConnectionOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface TranslateOptions extends TestConnectionOptions {
  signal?: AbortSignal;
}

function isChatCompletionResponse(value: unknown): value is { choices: unknown[] } {
  if (typeof value !== 'object' || value === null || !('choices' in value)) return false;
  return Array.isArray(value.choices) && value.choices.length > 0;
}

function chatCompletionContent(value: unknown): string | undefined {
  if (!isChatCompletionResponse(value)) return undefined;
  const choice: unknown = value.choices[0];
  if (typeof choice !== 'object' || choice === null || !('message' in choice)) return undefined;
  const message: unknown = choice.message;
  if (typeof message !== 'object' || message === null || !('content' in message)) return undefined;
  return typeof message.content === 'string' ? message.content : undefined;
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

    if (!response.ok) {
      throw new ProviderRequestError(
        mapProviderHttpStatus(response.status),
        parseRetryAfterMs(response.headers.get('Retry-After')),
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderRequestError('INVALID_RESPONSE');
    }
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

export async function translateOpenAICompatible(
  config: ProviderConfig,
  blocks: TranslationBlock[],
  targetLanguage: 'zh-CN',
  customPrompt: string,
  options: TranslateOptions = {},
): Promise<TranslationBatchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  }
  const timeoutMs = options.timeoutMs ?? 60_000;
  let timeout = setTimeout(() => controller.abort(), timeoutMs);
  const resetTimeout = (): void => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(), timeoutMs);
  };

  try {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (config.apiKey) headers.set('Authorization', `Bearer ${config.apiKey}`);
    const promptInput = { targetLanguage, blocks, customPrompt } as const;
    const requestContent = async (messages: ReturnType<typeof buildTranslationMessages>) => {
      const response = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          messages,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ProviderRequestError(
          mapProviderHttpStatus(response.status),
          parseRetryAfterMs(response.headers.get('Retry-After')),
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ProviderRequestError('INVALID_RESPONSE');
      }
      const content = chatCompletionContent(payload);
      if (content === undefined) throw new ProviderRequestError('INVALID_RESPONSE');
      return content;
    };

    const content = await requestContent(buildTranslationMessages(promptInput));
    const result = validateTranslationResponse(content, blocks);
    const needsFormatRepair =
      result.translations.length === 0 &&
      result.failures.length > 0 &&
      result.failures.every((failure) => failure.reason === 'INVALID_RESPONSE');
    if (!needsFormatRepair) return result;

    resetTimeout();
    const repairedContent = await requestContent(
      buildTranslationRepairMessages(promptInput, content),
    );
    return validateTranslationResponse(repairedContent, blocks);
  } catch (error: unknown) {
    if (error instanceof ProviderRequestError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ProviderRequestError('REQUEST_TIMEOUT');
    }
    throw new ProviderRequestError('NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}
