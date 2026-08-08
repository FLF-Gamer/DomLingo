import { describe, expect, it, vi } from 'vitest';

import { ProviderRequestError } from '../../src/providers/provider-error';
import { translateWithAdaptiveSplit } from '../../src/translation/adaptive';
import type { TranslationBatchResult, TranslationBlock } from '../../src/translation/types';

function blocksWithSegments(count: number): TranslationBlock[] {
  return [
    {
      id: 'block-1',
      context: 'A documentation block with several translation segments.',
      segments: Array.from({ length: count }, (_value, index) => ({
        id: `source-${index + 1}`,
        text: `English segment ${index + 1}.`,
      })),
    },
  ];
}

function successfulResult(blocks: TranslationBlock[]): TranslationBatchResult {
  return {
    translations: blocks.flatMap((block) =>
      block.segments.map((segment) => ({ id: segment.id, text: `译文:${segment.text}` })),
    ),
    failedIds: [],
    failures: [],
  };
}

function invalidResult(blocks: TranslationBlock[]): TranslationBatchResult {
  const ids = blocks.flatMap((block) => block.segments.map((segment) => segment.id));
  return {
    translations: [],
    failedIds: ids,
    failures: ids.map((id) => ({ id, reason: 'INVALID_RESPONSE' })),
  };
}

describe('adaptive translation fallback', () => {
  it('splits a malformed 20-segment response into two successful 10-segment requests', async () => {
    const sizes: number[] = [];
    const repairs: boolean[] = [];
    const translate = vi.fn(
      async (blocks: TranslationBlock[], options: { repairInvalidResponse: boolean }) => {
        const size = blocks.flatMap((block) => block.segments).length;
        sizes.push(size);
        repairs.push(options.repairInvalidResponse);
        return size > 10 ? invalidResult(blocks) : successfulResult(blocks);
      },
    );

    const result = await translateWithAdaptiveSplit(blocksWithSegments(20), translate);

    expect(sizes).toEqual([20, 10, 10]);
    expect(repairs).toEqual([true, false, false]);
    expect(result.failedIds).toEqual([]);
    expect(result.translations.map((translation) => translation.id)).toEqual(
      Array.from({ length: 20 }, (_value, index) => `source-${index + 1}`),
    );
  });

  it('recovers truncated responses by splitting until five-segment requests succeed', async () => {
    const sizes: number[] = [];
    const translate = vi.fn(async (blocks: TranslationBlock[]) => {
      const size = blocks.flatMap((block) => block.segments).length;
      sizes.push(size);
      if (size > 5) throw new ProviderRequestError('OUTPUT_TRUNCATED');
      return successfulResult(blocks);
    });

    const result = await translateWithAdaptiveSplit(blocksWithSegments(20), translate);

    expect(sizes).toEqual([20, 10, 5, 5, 10, 5, 5]);
    expect(result.translations).toHaveLength(20);
    expect(result.failures).toEqual([]);
  });

  it('retries only IDs omitted from an otherwise valid response', async () => {
    const requestedIds: string[][] = [];
    const translate = vi.fn(async (blocks: TranslationBlock[]) => {
      const ids = blocks.flatMap((block) => block.segments.map((segment) => segment.id));
      requestedIds.push(ids);
      if (requestedIds.length > 1) return successfulResult(blocks);
      return {
        translations: [{ id: ids[0]!, text: '首次成功译文。' }],
        failedIds: ids.slice(1),
        failures: ids.slice(1).map((id) => ({ id, reason: 'MISSING_ID' as const })),
      };
    });

    const result = await translateWithAdaptiveSplit(blocksWithSegments(4), translate);

    expect(requestedIds).toEqual([
      ['source-1', 'source-2', 'source-3', 'source-4'],
      ['source-2', 'source-3', 'source-4'],
    ]);
    expect(result.translations).toHaveLength(4);
    expect(result.failedIds).toEqual([]);
  });

  it('bounds persistent format failures and preserves unresolved IDs', async () => {
    const translate = vi.fn(async (blocks: TranslationBlock[]) => invalidResult(blocks));

    const result = await translateWithAdaptiveSplit(blocksWithSegments(20), translate, {
      maxAttempts: 4,
    });

    expect(translate).toHaveBeenCalledTimes(4);
    expect(result.translations).toEqual([]);
    expect(result.failedIds).toHaveLength(20);
    expect(result.failures.every((failure) => failure.reason === 'INVALID_RESPONSE')).toBe(true);
  });

  it('does not split authentication or transport policy failures', async () => {
    const translate = vi.fn(async () => {
      throw new ProviderRequestError('AUTHENTICATION_FAILED');
    });

    await expect(
      translateWithAdaptiveSplit(blocksWithSegments(20), translate),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    expect(translate).toHaveBeenCalledOnce();
  });
});
