export type SourceKind =
  'text-node' | 'placeholder' | 'alt' | 'title' | 'aria-label' | 'input-value';

export interface TranslationSegment {
  id: string;
  text: string;
}

export interface TranslationBlock {
  id: string;
  context: string;
  segments: TranslationSegment[];
}

export interface TranslationBatchPayload {
  requestId: string;
  sessionId: string;
  generation: number;
  blocks: TranslationBlock[];
}

export interface ValidatedTranslation {
  id: string;
  text: string;
}

export type TranslationResultFailureReason =
  'INVALID_RESPONSE' | 'OUTPUT_TRUNCATED' | 'MISSING_ID' | 'DUPLICATE_ID' | 'INVALID_TEXT';

export interface TranslationSegmentFailure {
  id: string;
  reason: TranslationResultFailureReason;
}

export interface TranslationBatchResult {
  translations: ValidatedTranslation[];
  failedIds: string[];
  failures: TranslationSegmentFailure[];
}
