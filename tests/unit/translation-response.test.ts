import { describe, expect, it } from 'vitest';

import { validateTranslationResponse } from '../../src/translation/response-validator';
import type { TranslationBlock } from '../../src/translation/types';

const blocks: TranslationBlock[] = [
  {
    id: 'block-1',
    context: 'A short paragraph.',
    segments: [
      { id: 'source-1', text: 'Hello world.' },
      { id: 'source-2', text: 'Read the guide.' },
    ],
  },
];

describe('validateTranslationResponse', () => {
  it('accepts valid translations in input ID order', () => {
    const result = validateTranslationResponse(
      JSON.stringify({
        translations: [
          { id: 'source-2', text: '阅读指南。' },
          { id: 'source-1', text: '你好，世界。' },
        ],
      }),
      blocks,
    );

    expect(result.translations.map((translation) => translation.id)).toEqual([
      'source-1',
      'source-2',
    ]);
    expect(result.failedIds).toEqual([]);
  });

  it('keeps invalid or missing nodes failed without rejecting valid siblings', () => {
    const result = validateTranslationResponse(
      JSON.stringify({
        translations: [
          { id: 'source-1', text: '安全译文。' },
          { id: 'source-2', text: '<script>unsafe</script>' },
          { id: 'unknown', text: 'ignored' },
        ],
      }),
      blocks,
    );

    expect(result.translations).toEqual([{ id: 'source-1', text: '安全译文。' }]);
    expect(result.failedIds).toEqual(['source-2']);
  });

  it('rejects duplicate IDs and non-JSON output', () => {
    expect(
      validateTranslationResponse(
        JSON.stringify({
          translations: [
            { id: 'source-1', text: '第一条' },
            { id: 'source-1', text: '第二条' },
          ],
        }),
        blocks,
      ),
    ).toMatchObject({ translations: [], failedIds: ['source-1', 'source-2'] });
    expect(validateTranslationResponse('```json\n{}\n```', blocks).failedIds).toEqual([
      'source-1',
      'source-2',
    ]);
  });
});
