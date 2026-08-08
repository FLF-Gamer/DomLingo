import type { TranslationBlock } from './types';

export type TranslationBatch = TranslationBlock[];
const DEFAULT_MAX_SEGMENTS_PER_BATCH = 40;

function blockCharacterCount(block: TranslationBlock): number {
  return (
    block.context.length +
    block.segments.reduce((total, segment) => total + segment.id.length + segment.text.length, 0)
  );
}

function splitBlockToFit(
  block: TranslationBlock,
  characterLimit: number,
  segmentLimit: number,
): TranslationBlock[] {
  if (blockCharacterCount(block) <= characterLimit && block.segments.length <= segmentLimit) {
    return [block];
  }

  const parts: TranslationBlock[] = [];
  let currentSegments: TranslationBlock['segments'] = [];
  let currentSegmentCharacters = 0;

  const pushPart = (): void => {
    if (currentSegments.length === 0) return;
    const availableContextCharacters = Math.max(0, characterLimit - currentSegmentCharacters);
    parts.push({
      id: `${block.id}:batch-part:${parts.length + 1}`,
      context: block.context.slice(0, availableContextCharacters),
      segments: currentSegments,
    });
    currentSegments = [];
    currentSegmentCharacters = 0;
  };

  for (const segment of block.segments) {
    const segmentCharacters = segment.id.length + segment.text.length;
    const minimumContextCharacters = Math.min(block.context.length, 200);
    if (
      currentSegments.length > 0 &&
      (currentSegments.length >= segmentLimit ||
        currentSegmentCharacters + segmentCharacters + minimumContextCharacters > characterLimit)
    ) {
      pushPart();
    }
    currentSegments.push(segment);
    currentSegmentCharacters += segmentCharacters;
  }

  pushPart();
  return parts;
}

export function buildTranslationBatches(
  blocks: TranslationBlock[],
  characterLimit: number,
  segmentLimit = DEFAULT_MAX_SEGMENTS_PER_BATCH,
): TranslationBatch[] {
  const safeLimit = Number.isFinite(characterLimit)
    ? Math.max(2_000, Math.floor(characterLimit))
    : 4_000;
  const batches: TranslationBatch[] = [];
  let currentBatch: TranslationBatch = [];
  let currentCharacters = 0;
  let currentSegments = 0;
  const safeSegmentLimit = Number.isFinite(segmentLimit)
    ? Math.max(1, Math.min(100, Math.floor(segmentLimit)))
    : DEFAULT_MAX_SEGMENTS_PER_BATCH;

  const normalizedBlocks = blocks.flatMap((block) =>
    splitBlockToFit(block, safeLimit, safeSegmentLimit),
  );
  for (const block of normalizedBlocks) {
    const characters = blockCharacterCount(block);
    const segments = block.segments.length;
    if (
      currentBatch.length > 0 &&
      (currentCharacters + characters > safeLimit || currentSegments + segments > safeSegmentLimit)
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentCharacters = 0;
      currentSegments = 0;
    }

    currentBatch.push(block);
    currentCharacters += characters;
    currentSegments += segments;
  }

  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}

export async function mapWithConcurrency<Input, Output>(
  values: Input[],
  concurrency: number,
  mapper: (value: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(values.length);
  let nextIndex = 0;
  const safeConcurrency = Number.isFinite(concurrency) ? Math.floor(concurrency) : 1;
  const workerCount = Math.max(1, Math.min(safeConcurrency, values.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await mapper(value, index);
    }
  });

  await Promise.all(workers);
  return results;
}
