import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { detectMainContent } from '../../src/content/main-content';
import {
  applyTranslations,
  collectPageSources,
  restoreOriginals,
} from '../../src/content/source-collector';

const FIXTURES = [
  ['static-article.html', 'article-main'],
  ['rich-text-article.html', 'rich-main'],
  ['documentation-page.html', 'docs-main'],
  ['article-form.html', 'form-main'],
] as const;

function loadFixture(name: string): void {
  document.documentElement.innerHTML = readFileSync(
    resolve(process.cwd(), 'tests', 'fixtures', name),
    'utf8',
  );
}

function protectedDomFingerprint(root: HTMLElement): string {
  return JSON.stringify(
    [root, ...root.querySelectorAll<HTMLElement>('*')].map((element) => ({
      tag: element.tagName,
      children: element.childElementCount,
      id: element.id,
      class: element.getAttribute('class'),
      href: element.getAttribute('href'),
      src: element.getAttribute('src'),
      style: element.getAttribute('style'),
    })),
  );
}

describe('static M2 fixtures', () => {
  afterEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  it.each(FIXTURES)('detects, translates, and exactly restores %s', (fixture, rootId) => {
    loadFixture(fixture);
    const detection = detectMainContent(document);
    expect(detection?.root.id).toBe(rootId);

    const root = detection!.root;
    const originalHtml = root.innerHTML;
    const fingerprint = protectedDomFingerprint(root);
    const collected = collectPageSources(root, `fixture-${rootId}`);
    expect(collected.records.length).toBeGreaterThanOrEqual(3);

    const translations = new Map(
      collected.records.map((record) => [record.id, `译文:${record.sourceText}`]),
    );
    const applied = applyTranslations(root, collected.records, translations);
    expect(applied.applied).toBe(collected.records.length);
    expect(protectedDomFingerprint(root)).toBe(fingerprint);

    const restored = restoreOriginals(root, collected.records);
    expect(restored.restored).toBe(collected.records.length);
    expect(root.innerHTML).toBe(originalHtml);
  });

  it('excludes documentation code, navigation, and sidebar text', () => {
    loadFixture('documentation-page.html');
    const root = detectMainContent(document)!.root;
    const sourceText = collectPageSources(root, 'docs')
      .records.map((record) => record.sourceText)
      .join(' ');

    expect(sourceText).not.toContain('fetch(endpoint');
    expect(sourceText).not.toContain('On this page');
    expect(sourceText).not.toContain('Documentation navigation');
  });
});
