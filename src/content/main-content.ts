import { containsEnglish, isElementVisible, isExcludedElement } from './content-rules';

const EXPLICIT_ROOT_SELECTORS = [
  'main',
  'article',
  '[role="main"]',
  '.post-content',
  '.article-content',
  '.entry-content',
  '.markdown-body',
  '#content',
];

const BLOCK_TEXT_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th';

export interface MainContentDetection {
  root: HTMLElement;
  score: number;
  englishCharacterCount: number;
}

interface CandidateMetrics {
  englishCharacterCount: number;
  textLength: number;
  linkTextLength: number;
  blockCount: number;
  controlCount: number;
}

export interface AsyncMainContentDetectionOptions {
  yieldEvery?: number;
  shouldContinue?: () => boolean;
}

interface AsyncScanContext {
  document: Document;
  yieldEvery: number;
  shouldContinue: () => boolean;
  scanned: number;
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

async function checkpoint(context: AsyncScanContext): Promise<boolean> {
  context.scanned += 1;
  if (context.scanned % context.yieldEvery === 0) {
    await yieldToMainThread(context.document);
  }
  return context.shouldContinue();
}

function collectCandidateMetrics(root: HTMLElement): CandidateMetrics {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  let linkTextLength = 0;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const parent = textNode.parentElement;
    if (!parent || isExcludedElement(parent) || !isElementVisible(parent)) continue;

    const value = textNode.nodeValue?.replace(/\s+/g, ' ').trim() ?? '';
    if (!value) continue;
    text += ` ${value}`;
    if (parent.closest('a')) linkTextLength += value.length;
  }

  const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_TEXT_SELECTOR)).filter(
    (element) => !isExcludedElement(element) && isElementVisible(element),
  );
  const controls = Array.from(root.querySelectorAll<HTMLElement>('button, input, select')).filter(
    (element) => !isExcludedElement(element) && isElementVisible(element),
  );

  return {
    englishCharacterCount: (text.match(/[A-Za-z]/g) ?? []).length,
    textLength: text.trim().length,
    linkTextLength,
    blockCount: blocks.length,
    controlCount: controls.length,
  };
}

async function collectCandidateMetricsAsync(
  root: HTMLElement,
  context: AsyncScanContext,
): Promise<CandidateMetrics | undefined> {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  let linkTextLength = 0;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const parent = textNode.parentElement;
    if (parent && !isExcludedElement(parent) && isElementVisible(parent)) {
      const value = textNode.nodeValue?.replace(/\s+/g, ' ').trim() ?? '';
      if (value) {
        text += ` ${value}`;
        if (parent.closest('a')) linkTextLength += value.length;
      }
    }
    if (!(await checkpoint(context))) return undefined;
  }

  let blockCount = 0;
  for (const element of root.querySelectorAll<HTMLElement>(BLOCK_TEXT_SELECTOR)) {
    if (!isExcludedElement(element) && isElementVisible(element)) blockCount += 1;
    if (!(await checkpoint(context))) return undefined;
  }

  let controlCount = 0;
  for (const element of root.querySelectorAll<HTMLElement>('button, input, select')) {
    if (!isExcludedElement(element) && isElementVisible(element)) controlCount += 1;
    if (!(await checkpoint(context))) return undefined;
  }

  return {
    englishCharacterCount: (text.match(/[A-Za-z]/g) ?? []).length,
    textLength: text.trim().length,
    linkTextLength,
    blockCount,
    controlCount,
  };
}

function semanticBonus(root: HTMLElement): number {
  if (root.tagName === 'MAIN') return 260;
  if (root.tagName === 'ARTICLE') return 240;
  if (root.getAttribute('role') === 'main') return 220;
  return 100;
}

function scoreCandidate(root: HTMLElement): MainContentDetection | undefined {
  if (!isElementVisible(root) || isExcludedElement(root)) return undefined;
  return scoredCandidate(root, collectCandidateMetrics(root));
}

function scoredCandidate(
  root: HTMLElement,
  metrics: CandidateMetrics,
): MainContentDetection | undefined {
  const hasEnoughContent =
    metrics.englishCharacterCount >= 40 ||
    (metrics.englishCharacterCount >= 20 && metrics.blockCount >= 1 && semanticBonus(root) >= 220);
  if (!hasEnoughContent) return undefined;

  const linkRatio = metrics.textLength > 0 ? metrics.linkTextLength / metrics.textLength : 1;
  const score =
    Math.min(metrics.englishCharacterCount, 3_000) +
    Math.min(metrics.blockCount, 40) * 55 +
    semanticBonus(root) -
    linkRatio * 320 -
    Math.min(metrics.controlCount, 20) * 12;

  return { root, score, englishCharacterCount: metrics.englishCharacterCount };
}

async function scoreCandidateAsync(
  root: HTMLElement,
  context: AsyncScanContext,
): Promise<MainContentDetection | undefined> {
  if (!isElementVisible(root) || isExcludedElement(root)) return undefined;
  const metrics = await collectCandidateMetricsAsync(root, context);
  return metrics ? scoredCandidate(root, metrics) : undefined;
}

function collectCandidates(document: Document): HTMLElement[] {
  const candidates = new Set<HTMLElement>();
  for (const selector of EXPLICIT_ROOT_SELECTORS) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      candidates.add(element);
    }
  }

  const paragraphs = Array.from(document.querySelectorAll<HTMLParagraphElement>('p')).filter(
    (paragraph) =>
      containsEnglish(paragraph.textContent ?? '') &&
      !isExcludedElement(paragraph) &&
      isElementVisible(paragraph),
  );
  const parentCounts = new Map<HTMLElement, number>();
  for (const paragraph of paragraphs) {
    let ancestor = paragraph.parentElement;
    for (let depth = 0; ancestor && depth < 3; depth += 1, ancestor = ancestor.parentElement) {
      if (ancestor === document.body || ancestor === document.documentElement) break;
      parentCounts.set(ancestor, (parentCounts.get(ancestor) ?? 0) + 1);
    }
  }
  for (const [element, paragraphCount] of parentCounts) {
    if (paragraphCount >= 2) candidates.add(element);
  }

  return [...candidates];
}

async function collectCandidatesAsync(
  document: Document,
  context: AsyncScanContext,
): Promise<HTMLElement[] | undefined> {
  const candidates = new Set<HTMLElement>();
  for (const selector of EXPLICIT_ROOT_SELECTORS) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      candidates.add(element);
      if (!(await checkpoint(context))) return undefined;
    }
  }

  const parentCounts = new Map<HTMLElement, number>();
  for (const paragraph of document.querySelectorAll<HTMLParagraphElement>('p')) {
    if (
      containsEnglish(paragraph.textContent ?? '') &&
      !isExcludedElement(paragraph) &&
      isElementVisible(paragraph)
    ) {
      let ancestor = paragraph.parentElement;
      for (let depth = 0; ancestor && depth < 3; depth += 1, ancestor = ancestor.parentElement) {
        if (ancestor === document.body || ancestor === document.documentElement) break;
        parentCounts.set(ancestor, (parentCounts.get(ancestor) ?? 0) + 1);
      }
    }
    if (!(await checkpoint(context))) return undefined;
  }
  for (const [element, paragraphCount] of parentCounts) {
    if (paragraphCount >= 2) candidates.add(element);
    if (!(await checkpoint(context))) return undefined;
  }

  return [...candidates];
}

export function detectMainContent(document: Document): MainContentDetection | undefined {
  return collectCandidates(document)
    .map(scoreCandidate)
    .filter((candidate): candidate is MainContentDetection => Boolean(candidate))
    .sort((left, right) => right.score - left.score)[0];
}

export async function detectMainContentAsync(
  document: Document,
  options: AsyncMainContentDetectionOptions = {},
): Promise<MainContentDetection | undefined> {
  const requestedYieldEvery = options.yieldEvery ?? 50;
  const context: AsyncScanContext = {
    document,
    yieldEvery: Number.isFinite(requestedYieldEvery)
      ? Math.max(1, Math.floor(requestedYieldEvery))
      : 50,
    shouldContinue: options.shouldContinue ?? (() => true),
    scanned: 0,
  };
  if (!context.shouldContinue()) return undefined;

  const candidates = await collectCandidatesAsync(document, context);
  if (!candidates) return undefined;

  let best: MainContentDetection | undefined;
  for (const candidate of candidates) {
    const scored = await scoreCandidateAsync(candidate, context);
    if (!context.shouldContinue()) return undefined;
    if (scored && (!best || scored.score > best.score)) best = scored;
  }
  return best;
}
