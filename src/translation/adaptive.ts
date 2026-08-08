import { ProviderRequestError } from '../providers/provider-error';
import type {
  TranslationBatchResult,
  TranslationBlock,
  TranslationResultFailureReason,
} from './types';

const ADAPTIVE_RESULT_FAILURES = new Set<TranslationResultFailureReason>([
  'INVALID_RESPONSE',
  'MISSING_ID',
  'DUPLICATE_ID',
]);

export interface AdaptiveAttemptOptions {
  repairInvalidResponse: boolean;
}

export interface AdaptiveTranslationOptions {
  maxAttempts?: number;
}

type TranslateAttempt = (
  blocks: TranslationBlock[],
  options: AdaptiveAttemptOptions,
) => Promise<TranslationBatchResult>;

function segmentIds(blocks: TranslationBlock[]): string[] {
  return blocks.flatMap((block) => block.segments.map((segment) => segment.id));
}

function filterBlocks(
  blocks: TranslationBlock[],
  includedIds: ReadonlySet<string>,
): TranslationBlock[] {
  return blocks.flatMap((block) => {
    const segments = block.segments.filter((segment) => includedIds.has(segment.id));
    return segments.length > 0 ? [{ ...block, segments }] : [];
  });
}

function rangeBlocks(
  blocks: TranslationBlock[],
  startIndex: number,
  endIndex: number,
): TranslationBlock[] {
  let index = 0;
  return blocks.flatMap((block) => {
    const segments = block.segments.filter(() => {
      const included = index >= startIndex && index < endIndex;
      index += 1;
      return included;
    });
    return segments.length > 0 ? [{ ...block, segments }] : [];
  });
}

function splitBlocks(blocks: TranslationBlock[]): [TranslationBlock[], TranslationBlock[]] | null {
  const count = segmentIds(blocks).length;
  if (count < 2) return null;
  const midpoint = Math.ceil(count / 2);
  return [rangeBlocks(blocks, 0, midpoint), rangeBlocks(blocks, midpoint, count)];
}

function failedResult(
  blocks: TranslationBlock[],
  reason: TranslationResultFailureReason,
): TranslationBatchResult {
  const ids = segmentIds(blocks);
  return {
    translations: [],
    failedIds: ids,
    failures: ids.map((id) => ({ id, reason })),
  };
}

function mergeResults(
  blocks: TranslationBlock[],
  results: TranslationBatchResult[],
): TranslationBatchResult {
  const translations = new Map(
    results.flatMap((result) => result.translations.map((item) => [item.id, item] as const)),
  );
  const failures = new Map(
    results.flatMap((result) => result.failures.map((item) => [item.id, item.reason] as const)),
  );
  const ids = segmentIds(blocks);

  return {
    translations: ids.flatMap((id) => {
      const translation = translations.get(id);
      return translation ? [translation] : [];
    }),
    failedIds: ids.filter((id) => !translations.has(id)),
    failures: ids.flatMap((id) => {
      if (translations.has(id)) return [];
      return [{ id, reason: failures.get(id) ?? ('INVALID_RESPONSE' as const) }];
    }),
  };
}

export async function translateWithAdaptiveSplit(
  blocks: TranslationBlock[],
  translate: TranslateAttempt,
  options: AdaptiveTranslationOptions = {},
): Promise<TranslationBatchResult> {
  const requestedMaxAttempts = options.maxAttempts ?? 12;
  const maxAttempts = Number.isFinite(requestedMaxAttempts)
    ? Math.max(1, Math.min(32, Math.floor(requestedMaxAttempts)))
    : 12;
  let attempts = 0;

  const run = async (
    currentBlocks: TranslationBlock[],
    repairInvalidResponse: boolean,
    fallbackReason: TranslationResultFailureReason = 'INVALID_RESPONSE',
  ): Promise<TranslationBatchResult> => {
    if (attempts >= maxAttempts) return failedResult(currentBlocks, fallbackReason);
    attempts += 1;

    let result: TranslationBatchResult;
    try {
      result = await translate(currentBlocks, { repairInvalidResponse });
    } catch (error: unknown) {
      if (
        !(error instanceof ProviderRequestError) ||
        (error.code !== 'INVALID_RESPONSE' && error.code !== 'OUTPUT_TRUNCATED')
      ) {
        throw error;
      }

      const reason = error.code === 'OUTPUT_TRUNCATED' ? 'OUTPUT_TRUNCATED' : 'INVALID_RESPONSE';
      const split = splitBlocks(currentBlocks);
      if (!split) return failedResult(currentBlocks, reason);
      const left = await run(split[0], false, reason);
      const right = await run(split[1], false, reason);
      return mergeResults(currentBlocks, [left, right]);
    }

    const retryableFailures = result.failures.filter((failure) =>
      ADAPTIVE_RESULT_FAILURES.has(failure.reason),
    );
    if (retryableFailures.length === 0) return result;

    if (result.translations.length > 0) {
      const retryIds = new Set(retryableFailures.map((failure) => failure.id));
      const retryBlocks = filterBlocks(currentBlocks, retryIds);
      const retried = await run(retryBlocks, false, retryableFailures[0]!.reason);
      return mergeResults(currentBlocks, [result, retried]);
    }

    if (retryableFailures.length === result.failures.length) {
      const split = splitBlocks(currentBlocks);
      if (split) {
        const left = await run(split[0], false, retryableFailures[0]!.reason);
        const right = await run(split[1], false, retryableFailures[0]!.reason);
        return mergeResults(currentBlocks, [left, right]);
      }
    }

    return result;
  };

  return run(blocks, true);
}
