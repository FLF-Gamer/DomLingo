import { describe, expect, it } from 'vitest';

import { buildTranslationBatches, mapWithConcurrency } from '../../src/translation/batching';
import type { TranslationBlock } from '../../src/translation/types';

function block(id: string, text: string): TranslationBlock {
  return { id, context: '', segments: [{ id: `${id}-source`, text }] };
}

describe('translation batching', () => {
  it('preserves block order while splitting at the character limit', () => {
    const batches = buildTranslationBatches(
      [block('one', 'a'.repeat(1_200)), block('two', 'b'.repeat(1_200)), block('three', 'short')],
      2_000,
    );

    expect(batches.map((batch) => batch.map((item) => item.id))).toEqual([
      ['one'],
      ['two', 'three'],
    ]);
  });

  it('maps values with bounded concurrency and stable result order', async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return value * 2;
    });

    expect(results).toEqual([2, 4, 6, 8]);
    expect(maximumActive).toBe(2);
  });

  it('splits an oversized semantic block without changing segment IDs', () => {
    const oversized: TranslationBlock = {
      id: 'large-block',
      context: 'context'.repeat(200),
      segments: [
        { id: 'part-1', text: 'a'.repeat(1_500) },
        { id: 'part-2', text: 'b'.repeat(1_500) },
        { id: 'part-3', text: 'c'.repeat(1_500) },
      ],
    };

    const batches = buildTranslationBatches([oversized], 2_000);
    expect(batches).toHaveLength(3);
    expect(
      batches.flatMap((batch) => batch.flatMap((item) => item.segments.map(({ id }) => id))),
    ).toEqual(['part-1', 'part-2', 'part-3']);
    expect(
      batches.every((batch) =>
        batch.every(
          (item) =>
            item.context.length +
              item.segments.reduce(
                (total, segment) => total + segment.id.length + segment.text.length,
                0,
              ) <=
            2_000,
        ),
      ),
    ).toBe(true);
  });
});
