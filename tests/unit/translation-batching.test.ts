import { describe, expect, it } from 'vitest';

import { buildTranslationBatches, mapWithConcurrency } from '../../src/translation/batching';
import type { TranslationBlock } from '../../src/translation/types';

function block(id: string, text: string): TranslationBlock {
  return { id, context: '', segments: [{ id: `${id}-source`, text }] };
}

describe('translation batching', () => {
  it('preserves block order while splitting at the character limit', () => {
    const batches = buildTranslationBatches(
      [block('one', 'a'.repeat(300)), block('two', 'b'.repeat(300)), block('three', 'short')],
      500,
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
});
