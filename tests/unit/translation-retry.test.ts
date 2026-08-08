import { describe, expect, it, vi } from 'vitest';

import { ProviderRequestError } from '../../src/providers/provider-error';
import { retryProviderRequest } from '../../src/translation/retry';

describe('provider request retry', () => {
  it('retries transient provider failures with bounded exponential delays', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ProviderRequestError('RATE_LIMITED'))
      .mockRejectedValueOnce(new ProviderRequestError('SERVER_ERROR'))
      .mockResolvedValue('translated');
    const wait = vi.fn(async (delay: number, signal?: AbortSignal) => {
      void delay;
      void signal;
    });

    await expect(
      retryProviderRequest(operation, {
        baseDelayMs: 100,
        maximumDelayMs: 1_000,
        random: () => 0,
        wait,
      }),
    ).resolves.toBe('translated');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([100, 200]);
  });

  it('does not retry configuration and authentication failures', async () => {
    const operation = vi.fn(async () => {
      throw new ProviderRequestError('AUTHENTICATION_FAILED');
    });
    const wait = vi.fn(async (delay: number, signal?: AbortSignal) => {
      void delay;
      void signal;
    });

    await expect(retryProviderRequest(operation, { wait })).rejects.toMatchObject({
      code: 'AUTHENTICATION_FAILED',
    });
    expect(operation).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it('honors a bounded Retry-After delay from the provider', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ProviderRequestError('RATE_LIMITED', 2_500))
      .mockResolvedValue('translated');
    const wait = vi.fn(async (delay: number) => {
      void delay;
    });

    await retryProviderRequest(operation, { maximumDelayMs: 2_000, wait });
    expect(wait).toHaveBeenCalledWith(2_000, undefined);
  });

  it('stops retrying as soon as the translation session is cancelled', async () => {
    const controller = new AbortController();
    const operation = vi.fn(async () => {
      throw new ProviderRequestError('RATE_LIMITED');
    });
    const wait = vi.fn(async (_delay: number, signal?: AbortSignal) => {
      controller.abort();
      if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    });

    await expect(
      retryProviderRequest(operation, { signal: controller.signal, wait }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(operation).toHaveBeenCalledOnce();
  });
});
