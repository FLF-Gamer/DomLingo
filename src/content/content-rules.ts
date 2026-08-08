const STRUCTURAL_EXCLUDED_CONTENT_SELECTORS = [
  'script',
  'style',
  'noscript',
  'pre',
  'textarea',
  '[contenteditable="true"]',
  '[translate="no"]',
  '[hidden]',
  '[aria-hidden="true"]',
  'nav',
  '[role="navigation"]',
  'aside',
  '[role="complementary"]',
  'footer',
  '.sidebar',
  '.advertisement',
  '[class*="advert"]',
  '[class*="recommend"]',
  '[class~="not-prose"]',
  '[class~="code-block"]',
  '[data-floating-buttons]',
  '[role="toolbar"]',
  'header button',
  'header [role="button"]',
] as const;

export const EXCLUDED_CONTENT_SELECTOR = [
  ...STRUCTURAL_EXCLUDED_CONTENT_SELECTORS,
  'code',
  'kbd',
  'samp',
].join(',');

const CONTEXT_EXCLUDED_CONTENT_SELECTOR = STRUCTURAL_EXCLUDED_CONTENT_SELECTORS.join(',');

export const SEMANTIC_BLOCK_SELECTOR = [
  'p',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'figcaption',
  'td',
  'th',
  'dt',
  'dd',
  'button',
  'label',
].join(',');

export function containsEnglish(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

export function isExcludedElement(element: Element | null): boolean {
  return Boolean(element?.closest(EXCLUDED_CONTENT_SELECTOR));
}

export function isContextExcludedElement(element: Element | null): boolean {
  return Boolean(element?.closest(CONTEXT_EXCLUDED_CONTENT_SELECTOR));
}

export function isElementVisible(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;

  const view = element.ownerDocument.defaultView;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = view?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  }
  return true;
}

export function normalizeContext(value: string, maximumLength = 1_200): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maximumLength);
}
