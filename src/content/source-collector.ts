import type { SourceKind, TranslationBlock } from '../translation/types';
import {
  containsEnglish,
  isElementVisible,
  isExcludedElement,
  normalizeContext,
  SEMANTIC_BLOCK_SELECTOR,
} from './content-rules';

type SupportedAttribute = 'placeholder' | 'alt' | 'title' | 'aria-label' | 'value';

export interface SourceRecord {
  id: string;
  kind: SourceKind;
  originalValue: string;
  sourceText: string;
  leadingWhitespace: string;
  trailingWhitespace: string;
  blockId: string;
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

  records.push({
    id: `${sessionId}:source:${records.length + 1}`,
    kind,
    originalValue: value,
    sourceText,
    leadingWhitespace,
    trailingWhitespace,
    blockId,
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

  const blockById = new Map<string, TranslationBlock>();
  for (const record of records) {
    let block = blockById.get(record.blockId);
    if (!block) {
      const element = record.target instanceof Text ? record.target.parentElement : record.target;
      const semanticBlock = element ? nearestSemanticBlock(element, root) : root;
      block = { id: record.blockId, context: contextForBlock(semanticBlock), segments: [] };
      blockById.set(record.blockId, block);
    }
    block.segments.push({ id: record.id, text: record.sourceText });
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
    const translated = translations.get(record.id);
    if (translated === undefined) continue;
    if (!isRecordInRoot(record, root) || currentRecordValue(record) !== record.originalValue) {
      summary.stale += 1;
      continue;
    }

    const appliedValue = `${record.leadingWhitespace}${translated}${record.trailingWhitespace}`;
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
