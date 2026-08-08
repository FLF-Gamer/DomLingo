import { ProviderRequestError, mapProviderHttpStatus, parseRetryAfterMs } from './provider-error';
import type { ProviderConfig, StructuredOutputMode } from './types';
import { buildTranslationMessages, buildTranslationRepairMessages } from '../translation/prompt';
import { validateTranslationResponse } from '../translation/response-validator';
import type { TranslationBatchResult, TranslationBlock } from '../translation/types';

interface TestConnectionOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface TranslateOptions extends TestConnectionOptions {
  signal?: AbortSignal;
  repairInvalidResponse?: boolean;
}

interface ChatCompletionResult {
  content?: string;
  finishReason?: string;
}

function isChatCompletionResponse(value: unknown): value is { choices: unknown[] } {
  if (typeof value !== 'object' || value === null || !('choices' in value)) return false;
  return Array.isArray(value.choices) && value.choices.length > 0;
}

function chatCompletionResult(value: unknown): ChatCompletionResult | undefined {
  if (!isChatCompletionResponse(value)) return undefined;
  const choice: unknown = value.choices[0];
  if (typeof choice !== 'object' || choice === null || !('message' in choice)) return undefined;
  const message: unknown = choice.message;
  if (typeof message !== 'object' || message === null) return undefined;
  return {
    ...('content' in message && typeof message.content === 'string'
      ? { content: message.content }
      : {}),
    ...('finish_reason' in choice && typeof choice.finish_reason === 'string'
      ? { finishReason: choice.finish_reason }
      : {}),
  };
}

function providerHeaders(config: ProviderConfig): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (config.apiKey) headers.set('Authorization', `Bearer ${config.apiKey}`);
  return headers;
}

async function parseProviderPayload(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new ProviderRequestError(
      mapProviderHttpStatus(response.status),
      parseRetryAfterMs(response.headers.get('Retry-After')),
    );
  }

  try {
    return await response.json();
  } catch {
    throw new ProviderRequestError('INVALID_RESPONSE');
  }
}

const PROBE_SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
} as const;

const TRANSLATION_SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['translations'],
  additionalProperties: false,
} as const;

function responseFormat(
  mode: StructuredOutputMode,
  schema: object,
  name: string,
): object | undefined {
  if (mode === 'json-schema') {
    return { type: 'json_schema', json_schema: { name, strict: true, schema } };
  }
  if (mode === 'json-object') return { type: 'json_object' };
  return undefined;
}

function translationMaxTokens(blocks: TranslationBlock[]): number {
  const segments = blocks.flatMap((block) => block.segments);
  const textCharacters = segments.reduce((total, segment) => total + segment.text.length, 0);
  const idCharacters = segments.reduce((total, segment) => total + segment.id.length, 0);
  const estimate = textCharacters + Math.ceil(idCharacters / 3) + segments.length * 32 + 128;
  return Math.max(512, Math.min(8_192, estimate));
}

export async function testOpenAICompatibleConnection(
  config: ProviderConfig,
  options: TestConnectionOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);

  try {
    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: providerHeaders(config),
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 8,
        stream: false,
      }),
      signal: controller.signal,
    });

    const payload = await parseProviderPayload(response);
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

export async function detectOpenAICompatibleStructuredOutput(
  config: ProviderConfig,
  options: TestConnectionOptions = {},
): Promise<StructuredOutputMode> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15_000;
  let timeout = setTimeout(() => controller.abort(), timeoutMs);
  const resetTimeout = (): void => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(), timeoutMs);
  };

  try {
    for (const mode of ['json-schema', 'json-object'] as const) {
      const format = responseFormat(mode, PROBE_SCHEMA, 'domlingo_capability_probe');
      const response = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers: providerHeaders(config),
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: 'user',
              content:
                mode === 'json-schema'
                  ? 'Use the requested JSON response format to report whether one plus one equals two.'
                  : 'Return JSON exactly matching this object: {"ok":true}',
            },
          ],
          max_tokens: 32,
          temperature: 0,
          response_format: format,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const code = mapProviderHttpStatus(response.status);
        if (code === 'INVALID_REQUEST' || code === 'ENDPOINT_NOT_FOUND') {
          resetTimeout();
          continue;
        }
        throw new ProviderRequestError(
          code,
          parseRetryAfterMs(response.headers.get('Retry-After')),
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        resetTimeout();
        continue;
      }
      const completion = chatCompletionResult(payload);
      if (completion?.finishReason !== 'length' && completion?.content) {
        try {
          const parsed = JSON.parse(completion.content) as { ok?: unknown };
          if (parsed.ok === true) return mode;
        } catch {
          // A provider may accept but ignore response_format. Probe the next compatibility level.
        }
      }
      resetTimeout();
    }

    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: providerHeaders(config),
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 8,
        stream: false,
      }),
      signal: controller.signal,
    });
    const payload = await parseProviderPayload(response);
    if (!isChatCompletionResponse(payload)) throw new ProviderRequestError('INVALID_RESPONSE');
    return 'prompt';
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
    const headers = providerHeaders(config);
    const promptInput = { targetLanguage, blocks, customPrompt } as const;
    const mode = config.structuredOutputMode ?? 'prompt';
    const format = responseFormat(mode, TRANSLATION_SCHEMA, 'domlingo_translation_batch');
    const requestContent = async (messages: ReturnType<typeof buildTranslationMessages>) => {
      const response = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          max_tokens: translationMaxTokens(blocks),
          messages,
          ...(format ? { response_format: format } : {}),
          stream: false,
        }),
        signal: controller.signal,
      });

      const payload = await parseProviderPayload(response);
      const completion = chatCompletionResult(payload);
      if (completion?.finishReason === 'length') {
        throw new ProviderRequestError('OUTPUT_TRUNCATED');
      }
      if (completion?.content === undefined) throw new ProviderRequestError('INVALID_RESPONSE');
      return completion.content;
    };

    const content = await requestContent(buildTranslationMessages(promptInput));
    const result = validateTranslationResponse(content, blocks);
    const needsFormatRepair =
      result.translations.length === 0 &&
      result.failures.length > 0 &&
      result.failures.every((failure) => failure.reason === 'INVALID_RESPONSE');
    if (!needsFormatRepair || options.repairInvalidResponse === false) return result;

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
