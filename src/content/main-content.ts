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

function semanticBonus(root: HTMLElement): number {
  if (root.tagName === 'MAIN') return 260;
  if (root.tagName === 'ARTICLE') return 240;
  if (root.getAttribute('role') === 'main') return 220;
  return 100;
}

function scoreCandidate(root: HTMLElement): MainContentDetection | undefined {
  if (!isElementVisible(root) || isExcludedElement(root)) return undefined;

  const metrics = collectCandidateMetrics(root);
  const hasEnoughContent =
    metrics.englishCharacterCount >= 40 ||
    (metrics.englishCharacterCount >= 20 && metrics.blockCount >= 1 && semanticBonus(root) >= 220);
  if (!hasEnoughContent || !containsEnglish(root.textContent ?? '')) return undefined;

  const linkRatio = metrics.textLength > 0 ? metrics.linkTextLength / metrics.textLength : 1;
  const score =
    Math.min(metrics.englishCharacterCount, 3_000) +
    Math.min(metrics.blockCount, 40) * 55 +
    semanticBonus(root) -
    linkRatio * 320 -
    Math.min(metrics.controlCount, 20) * 12;

  return { root, score, englishCharacterCount: metrics.englishCharacterCount };
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

export function detectMainContent(document: Document): MainContentDetection | undefined {
  return collectCandidates(document)
    .map(scoreCandidate)
    .filter((candidate): candidate is MainContentDetection => Boolean(candidate))
    .sort((left, right) => right.score - left.score)[0];
}
