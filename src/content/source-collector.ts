import type { SourceKind, TranslationBlock, TranslationSegment } from '../translation/types';
import {
  containsEnglish,
  isElementVisible,
  isExcludedElement,
  normalizeContext,
  SEMANTIC_BLOCK_SELECTOR,
} from './content-rules';

type SupportedAttribute = 'placeholder' | 'alt' | 'title' | 'aria-label' | 'value';
const MAX_SEGMENT_CHARACTERS = 1_600;

export interface SourceRecord {
  id: string;
  kind: SourceKind;
  originalValue: string;
  sourceText: string;
  leadingWhitespace: string;
  trailingWhitespace: string;
  blockId: string;
  segments: TranslationSegment[];
  target: Text | HTMLElement;
  attribute?: SupportedAttribute;
  appliedValue?: string;
}

export interface CollectedPageSources {
  records: SourceRecord[];
  blocks: TranslationBlock[];
}

export interface MutationSummary {
  applied: number;
  restored: number;
  stale: number;
}

export function splitLongSourceText(
  value: string,
  maximumCharacters = MAX_SEGMENT_CHARACTERS,
): string[] {
  const safeMaximum = Math.max(200, Math.floor(maximumCharacters));
  if (value.length <= safeMaximum) return [value];

  const parts: string[] = [];
  let remaining = value;
  while (remaining.length > safeMaximum) {
    const minimumBoundary = Math.floor(safeMaximum * 0.55);
    const window = remaining.slice(0, safeMaximum + 1);
    let boundary = -1;
    const sentenceBoundary = /[.!?。！？](?:\s+|$)/g;
    for (let match = sentenceBoundary.exec(window); match; match = sentenceBoundary.exec(window)) {
      const candidate = match.index + match[0].length;
      if (candidate >= minimumBoundary && candidate <= safeMaximum) boundary = candidate;
    }

    if (boundary < minimumBoundary) boundary = window.lastIndexOf(' ', safeMaximum);
    if (boundary < minimumBoundary) boundary = safeMaximum;

    const part = remaining.slice(0, boundary).trim();
    if (part) parts.push(part);
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function splitWhitespace(value: string): {
  leadingWhitespace: string;
  sourceText: string;
  trailingWhitespace: string;
} {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
  return {
    leadingWhitespace: match?.[1] ?? '',
    sourceText: match?.[2] ?? value,
    trailingWhitespace: match?.[3] ?? '',
  };
}

function nearestSemanticBlock(element: HTMLElement, root: HTMLElement): HTMLElement {
  const block = element.closest<HTMLElement>(SEMANTIC_BLOCK_SELECTOR);
  return block && (block === root || root.contains(block))
    ? block
    : (element.parentElement ?? root);
}

function contextForBlock(block: HTMLElement): string {
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const values: string[] = [];

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = (node as Text).parentElement;
    if (!parent || isExcludedElement(parent) || !isElementVisible(parent)) continue;
    const value = node.nodeValue?.trim();
    if (value) values.push(value);
  }

  return normalizeContext(values.join(' '));
}

function addRecord(
  records: SourceRecord[],
  blockIds: Map<HTMLElement, string>,
  sessionId: string,
  kind: SourceKind,
  value: string,
  target: Text | HTMLElement,
  root: HTMLElement,
  attribute?: SupportedAttribute,
): void {
  const { leadingWhitespace, sourceText, trailingWhitespace } = splitWhitespace(value);
  if (!sourceText || !containsEnglish(sourceText)) return;

  const element = target instanceof Text ? target.parentElement : target;
  if (!element) return;
  const block = nearestSemanticBlock(element, root);
  let blockId = blockIds.get(block);
  if (!blockId) {
    blockId = `${sessionId}:block:${blockIds.size + 1}`;
    blockIds.set(block, blockId);
  }

  const id = `${sessionId}:source:${records.length + 1}`;
  const sourceParts = splitLongSourceText(sourceText);
  const segments = sourceParts.map((text, index) => ({
    id: sourceParts.length === 1 ? id : `${id}:part:${index + 1}`,
    text,
  }));

  records.push({
    id,
    kind,
    originalValue: value,
    sourceText,
    leadingWhitespace,
    trailingWhitespace,
    blockId,
    segments,
    target,
    ...(attribute ? { attribute } : {}),
  });
}

function collectTextNodes(
  root: HTMLElement,
  records: SourceRecord[],
  blockIds: Map<HTMLElement, string>,
  sessionId: string,
): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const parent = textNode.parentElement;
    const value = textNode.nodeValue ?? '';
    if (!parent || isExcludedElement(parent) || !isElementVisible(parent)) continue;
    addRecord(records, blockIds, sessionId, 'text-node', value, textNode, root);
  }
}

function collectAttributes(
  root: HTMLElement,
  records: SourceRecord[],
  blockIds: Map<HTMLElement, string>,
  sessionId: string,
): void {
  const elements = [root, ...root.querySelectorAll<HTMLElement>('*')];
  for (const element of elements) {
    if (isExcludedElement(element) || !isElementVisible(element)) continue;

    const attributes: Array<[SourceKind, SupportedAttribute, string | null]> = [
      ['placeholder', 'placeholder', element.getAttribute('placeholder')],
      ['alt', 'alt', element.getAttribute('alt')],
      ['title', 'title', element.getAttribute('title')],
      ['aria-label', 'aria-label', element.getAttribute('aria-label')],
    ];

    if (
      element instanceof HTMLInputElement &&
      ['button', 'submit', 'reset'].includes(element.type)
    ) {
      attributes.push(['input-value', 'value', element.value]);
    }

    for (const [kind, attribute, value] of attributes) {
      if (value !== null) {
        addRecord(records, blockIds, sessionId, kind, value, element, root, attribute);
      }
    }
  }
}

export function collectPageSources(root: HTMLElement, sessionId: string): CollectedPageSources {
  const records: SourceRecord[] = [];
  const blockIds = new Map<HTMLElement, string>();
  collectTextNodes(root, records, blockIds, sessionId);
  collectAttributes(root, records, blockIds, sessionId);

  return buildCollectedPageSources(root, records);
}

function yieldToMainThread(document: Document): Promise<void> {
  return new Promise((resolve) => {
    const view = document.defaultView;
    if (!view) {
      resolve();
      return;
    }
    view.setTimeout(resolve, 0);
  });
}

export async function collectPageSourcesAsync(
  root: HTMLElement,
  sessionId: string,
  yieldEvery = 250,
): Promise<CollectedPageSources> {
  const safeYieldEvery = Number.isFinite(yieldEvery) ? Math.max(1, Math.floor(yieldEvery)) : 250;
  const records: SourceRecord[] = [];
  const blockIds = new Map<HTMLElement, string>();
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let scanned = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const parent = textNode.parentElement;
    const value = textNode.nodeValue ?? '';
    if (parent && !isExcludedElement(parent) && isElementVisible(parent)) {
      addRecord(records, blockIds, sessionId, 'text-node', value, textNode, root);
    }
    scanned += 1;
    if (scanned % safeYieldEvery === 0) await yieldToMainThread(root.ownerDocument);
  }

  const elements = [root, ...root.querySelectorAll<HTMLElement>('*')];
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (element && !isExcludedElement(element) && isElementVisible(element)) {
      const attributes: Array<[SourceKind, SupportedAttribute, string | null]> = [
        ['placeholder', 'placeholder', element.getAttribute('placeholder')],
        ['alt', 'alt', element.getAttribute('alt')],
        ['title', 'title', element.getAttribute('title')],
        ['aria-label', 'aria-label', element.getAttribute('aria-label')],
      ];
      if (
        element instanceof HTMLInputElement &&
        ['button', 'submit', 'reset'].includes(element.type)
      ) {
        attributes.push(['input-value', 'value', element.value]);
      }
      for (const [kind, attribute, value] of attributes) {
        if (value !== null) {
          addRecord(records, blockIds, sessionId, kind, value, element, root, attribute);
        }
      }
    }
    if ((index + 1) % safeYieldEvery === 0) await yieldToMainThread(root.ownerDocument);
  }

  return buildCollectedPageSources(root, records);
}

function buildCollectedPageSources(
  root: HTMLElement,
  records: SourceRecord[],
): CollectedPageSources {
  const blockById = new Map<string, TranslationBlock>();
  for (const record of records) {
    let block = blockById.get(record.blockId);
    if (!block) {
      const element = record.target instanceof Text ? record.target.parentElement : record.target;
      const semanticBlock = element ? nearestSemanticBlock(element, root) : root;
      block = { id: record.blockId, context: contextForBlock(semanticBlock), segments: [] };
      blockById.set(record.blockId, block);
    }
    block.segments.push(...record.segments);
  }

  return { records, blocks: [...blockById.values()] };
}

function currentRecordValue(record: SourceRecord): string | undefined {
  if (record.target instanceof Text) return record.target.nodeValue ?? '';
  if (record.attribute === 'value' && record.target instanceof HTMLInputElement) {
    return record.target.value;
  }
  return record.attribute ? (record.target.getAttribute(record.attribute) ?? undefined) : undefined;
}

function writeRecordValue(record: SourceRecord, value: string): void {
  if (record.target instanceof Text) {
    record.target.nodeValue = value;
  } else if (record.attribute === 'value' && record.target instanceof HTMLInputElement) {
    record.target.value = value;
  } else if (record.attribute) {
    record.target.setAttribute(record.attribute, value);
  }
}

function isRecordInRoot(record: SourceRecord, root: HTMLElement): boolean {
  const node = record.target;
  return node.isConnected && (node === root || root.contains(node));
}

export function applyTranslations(
  root: HTMLElement,
  records: SourceRecord[],
  translations: ReadonlyMap<string, string>,
): MutationSummary {
  const summary: MutationSummary = { applied: 0, restored: 0, stale: 0 };

  for (const record of records) {
    if (record.appliedValue !== undefined) continue;
    const translatedParts = record.segments.map((segment) => translations.get(segment.id));
    if (translatedParts.some((part) => part === undefined)) continue;
    if (!isRecordInRoot(record, root) || currentRecordValue(record) !== record.originalValue) {
      summary.stale += 1;
      continue;
    }

    const appliedValue = `${record.leadingWhitespace}${translatedParts.join('')}${record.trailingWhitespace}`;
    writeRecordValue(record, appliedValue);
    record.appliedValue = appliedValue;
    summary.applied += 1;
  }

  return summary;
}

export function restoreOriginals(root: HTMLElement, records: SourceRecord[]): MutationSummary {
  const summary: MutationSummary = { applied: 0, restored: 0, stale: 0 };

  for (const record of records) {
    if (record.appliedValue === undefined) continue;
    if (!isRecordInRoot(record, root) || currentRecordValue(record) !== record.appliedValue) {
      summary.stale += 1;
      continue;
    }

    writeRecordValue(record, record.originalValue);
    delete record.appliedValue;
    summary.restored += 1;
  }

  return summary;
}
