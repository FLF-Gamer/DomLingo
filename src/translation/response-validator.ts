import type {
  TranslationBatchResult,
  TranslationBlock,
  TranslationResultFailureReason,
  ValidatedTranslation,
} from './types';

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

function parseResponseJson(rawContent: string): unknown {
  try {
    return JSON.parse(rawContent);
  } catch {
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(rawContent.trim());
    if (!fenced?.[1]) return undefined;
    try {
      return JSON.parse(fenced[1]);
    } catch {
      return undefined;
    }
  }
}

export function validateTranslationResponse(
  rawContent: string,
  blocks: TranslationBlock[],
): TranslationBatchResult {
  const expectedIds = expectedSegmentIds(blocks);
  const expectedIdSet = new Set(expectedIds);
  const failAll = (reason: TranslationResultFailureReason): TranslationBatchResult => ({
    translations: [],
    failedIds: expectedIds,
    failures: expectedIds.map((id) => ({ id, reason })),
  });
  if (new TextEncoder().encode(rawContent).byteLength > MAX_RESPONSE_BYTES) {
    return failAll('INVALID_RESPONSE');
  }

  const parsed = parseResponseJson(rawContent);

  if (!isObject(parsed) || !Array.isArray(parsed.translations)) {
    return failAll('INVALID_RESPONSE');
  }

  const translationsById = new Map<string, ValidatedTranslation>();
  const failureById = new Map<string, TranslationResultFailureReason>();

  for (const item of parsed.translations) {
    if (!isObject(item) || typeof item.id !== 'string' || !expectedIdSet.has(item.id)) continue;

    if (translationsById.has(item.id) || failureById.has(item.id)) {
      translationsById.delete(item.id);
      failureById.set(item.id, 'DUPLICATE_ID');
      continue;
    }

    if (
      typeof item.text !== 'string' ||
      item.text.length === 0 ||
      item.text.length > MAX_TRANSLATION_LENGTH ||
      containsUnsafeControlCharacter(item.text) ||
      HTML_TAG_PATTERN.test(item.text)
    ) {
      failureById.set(item.id, 'INVALID_TEXT');
      continue;
    }

    translationsById.set(item.id, { id: item.id, text: item.text });
  }

  const failures = expectedIds.flatMap((id) => {
    if (translationsById.has(id)) return [];
    return [{ id, reason: failureById.get(id) ?? ('MISSING_ID' as const) }];
  });

  return {
    translations: expectedIds.flatMap((id) => {
      const translation = translationsById.get(id);
      return translation ? [translation] : [];
    }),
    failedIds: failures.map(({ id }) => id),
    failures,
  };
}
