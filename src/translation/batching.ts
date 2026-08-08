import type { TranslationBlock } from './types';

export type TranslationBatch = TranslationBlock[];

function blockCharacterCount(block: TranslationBlock): number {
  return (
    block.context.length +
    block.segments.reduce((total, segment) => total + segment.id.length + segment.text.length, 0)
  );
}

export function buildTranslationBatches(
  blocks: TranslationBlock[],
  characterLimit: number,
): TranslationBatch[] {
  const safeLimit = Number.isFinite(characterLimit)
    ? Math.max(500, Math.floor(characterLimit))
    : 4_000;
  const batches: TranslationBatch[] = [];
  let currentBatch: TranslationBatch = [];
  let currentCharacters = 0;

  for (const block of blocks) {
    const characters = blockCharacterCount(block);
    if (currentBatch.length > 0 && currentCharacters + characters > safeLimit) {
      batches.push(currentBatch);
      currentBatch = [];
      currentCharacters = 0;
    }

    currentBatch.push(block);
    currentCharacters += characters;
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
