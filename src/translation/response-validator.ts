import type { TranslationBatchResult, TranslationBlock, ValidatedTranslation } from './types';

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_TRANSLATION_LENGTH = 20_000;
const HTML_TAG_PATTERN = /<\/?[A-Za-z][^>]*>/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function expectedSegmentIds(blocks: TranslationBlock[]): string[] {
  return blocks.flatMap((block) => block.segments.map((segment) => segment.id));
}

function containsUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint === 0x7f ||
      (codePoint >= 0 && codePoint <= 0x08) ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f)
    ) {
      return true;
    }
  }
  return false;
}

export function validateTranslationResponse(
  rawContent: string,
  blocks: TranslationBlock[],
): TranslationBatchResult {
  const expectedIds = expectedSegmentIds(blocks);
  const expectedIdSet = new Set(expectedIds);
  if (new TextEncoder().encode(rawContent).byteLength > MAX_RESPONSE_BYTES) {
    return { translations: [], failedIds: expectedIds };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return { translations: [], failedIds: expectedIds };
  }

  if (!isObject(parsed) || !Array.isArray(parsed.translations)) {
    return { translations: [], failedIds: expectedIds };
  }

  const translationsById = new Map<string, ValidatedTranslation>();
  const invalidIds = new Set<string>();

  for (const item of parsed.translations) {
    if (!isObject(item) || typeof item.id !== 'string' || !expectedIdSet.has(item.id)) continue;

    if (translationsById.has(item.id) || invalidIds.has(item.id)) {
      translationsById.delete(item.id);
      invalidIds.add(item.id);
      continue;
    }

    if (
      typeof item.text !== 'string' ||
      item.text.length === 0 ||
      item.text.length > MAX_TRANSLATION_LENGTH ||
      containsUnsafeControlCharacter(item.text) ||
      HTML_TAG_PATTERN.test(item.text)
    ) {
      invalidIds.add(item.id);
      continue;
    }

    translationsById.set(item.id, { id: item.id, text: item.text });
  }

  return {
    translations: expectedIds.flatMap((id) => {
      const translation = translationsById.get(id);
      return translation ? [translation] : [];
    }),
    failedIds: expectedIds.filter((id) => !translationsById.has(id)),
  };
}
