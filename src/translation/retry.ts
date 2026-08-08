import { ProviderRequestError } from '../providers/provider-error';
import type { ProviderErrorCode } from '../providers/types';

const RETRYABLE_CODES = new Set<ProviderErrorCode>([
  'RATE_LIMITED',
  'SERVER_ERROR',
  'NETWORK_ERROR',
  'REQUEST_TIMEOUT',
]);

type WaitForRetry = (delayMs: number, signal?: AbortSignal) => Promise<void>;

export interface ProviderRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maximumDelayMs?: number;
  signal?: AbortSignal;
  random?: () => number;
  wait?: WaitForRetry;
}

function abortError(): DOMException {
  return new DOMException('The translation session was cancelled.', 'AbortError');
}

async function defaultWait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();

  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timeout = setTimeout(finish, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(abortError());
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function retryProviderRequest<Result>(
  operation: () => Promise<Result>,
  options: ProviderRetryOptions = {},
): Promise<Result> {
  const maxAttempts = Math.max(1, Math.min(5, Math.floor(options.maxAttempts ?? 3)));
  const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? 600));
  const maximumDelayMs = Math.max(baseDelayMs, Math.floor(options.maximumDelayMs ?? 30_000));
  const random = options.random ?? Math.random;
  const wait = options.wait ?? defaultWait;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw abortError();

    try {
      return await operation();
    } catch (error: unknown) {
      const retryable = error instanceof ProviderRequestError && RETRYABLE_CODES.has(error.code);
      if (!retryable || attempt === maxAttempts || options.signal?.aborted) throw error;

      const exponentialDelay = Math.min(maximumDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(exponentialDelay * 0.25 * Math.max(0, Math.min(1, random())));
      const delay =
        error instanceof ProviderRequestError && error.retryAfterMs !== undefined
          ? Math.min(maximumDelayMs, Math.max(0, error.retryAfterMs))
          : Math.min(maximumDelayMs, exponentialDelay + jitter);
      await wait(delay, options.signal);
    }
  }

  throw new ProviderRequestError('NETWORK_ERROR');
}
