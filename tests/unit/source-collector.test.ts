import { afterEach, describe, expect, it } from 'vitest';

import {
  applyTranslations,
  collectPageSources,
  restoreOriginals,
  splitLongSourceText,
} from '../../src/content/source-collector';

describe('page source collection and DOM transactions', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('collects text and whitelisted attributes while excluding unsafe content', () => {
    document.body.innerHTML = `
      <main id="root">
        <h1>Translation guide</h1>
        <p class="intro">  Read <strong>this guide</strong> today.  </p>
        <p><a href="/docs">Open documentation</a></p>
        <pre><code>const message = "Do not translate code";</code></pre>
        <nav>Navigation should stay unchanged</nav>
        <img src="cover.png" alt="Guide cover" title="Illustration title">
        <input id="search" placeholder="Search the article" aria-label="Article search">
        <input id="submit" type="submit" value="Send request">
        <p hidden>Hidden English text</p>
        <div style="display: none"><p>CSS hidden English text</p></div>
      </main>
    `;

    const root = document.querySelector<HTMLElement>('#root')!;
    const collected = collectPageSources(root, 'session');
    const sourceTexts = collected.records.map((record) => record.sourceText);

    expect(sourceTexts).toEqual(
      expect.arrayContaining([
        'Translation guide',
        'Read',
        'this guide',
        'today.',
        'Open documentation',
        'Guide cover',
        'Illustration title',
        'Search the article',
        'Article search',
        'Send request',
      ]),
    );
    expect(sourceTexts.join(' ')).not.toContain('Do not translate code');
    expect(sourceTexts.join(' ')).not.toContain('Navigation should stay unchanged');
    expect(sourceTexts.join(' ')).not.toContain('Hidden English text');
    expect(sourceTexts.join(' ')).not.toContain('CSS hidden English text');
  });

  it('writes translations without changing structure and restores exact originals', () => {
    document.body.innerHTML = `
      <main id="root">
        <p class="intro">  Read <a href="/docs">this guide</a> today.  </p>
        <img src="cover.png" alt="Guide cover">
        <input id="search" placeholder="Search the article">
      </main>
    `;

    const root = document.querySelector<HTMLElement>('#root')!;
    const originalHtml = root.innerHTML;
    const collected = collectPageSources(root, 'session');
    const translations = new Map(
      collected.records.map((record) => [record.id, `译文:${record.sourceText}`]),
    );

    expect(applyTranslations(root, collected.records, translations).applied).toBe(
      collected.records.length,
    );
    expect(root.querySelector('a')?.getAttribute('href')).toBe('/docs');
    expect(root.querySelector('p')?.className).toBe('intro');
    expect(root.querySelector('img')?.getAttribute('src')).toBe('cover.png');
    expect(root.querySelector('p')?.textContent?.startsWith('  ')).toBe(true);
    expect(root.querySelector('p')?.textContent?.endsWith('  ')).toBe(true);

    expect(restoreOriginals(root, collected.records).restored).toBe(collected.records.length);
    expect(root.innerHTML).toBe(originalHtml);
  });

  it('does not overwrite a value changed by the website after translation', () => {
    document.body.innerHTML = '<main id="root"><p>Original English paragraph.</p></main>';
    const root = document.querySelector<HTMLElement>('#root')!;
    const collected = collectPageSources(root, 'session');
    const record = collected.records[0]!;

    applyTranslations(root, collected.records, new Map([[record.id, '中文译文']]));
    root.querySelector('p')!.textContent = 'Website changed this value.';

    expect(restoreOriginals(root, collected.records)).toMatchObject({ restored: 0, stale: 1 });
    expect(root.querySelector('p')?.textContent).toBe('Website changed this value.');
  });

  it('splits oversized nodes near sentence boundaries and applies them as one transaction', () => {
    const source = `${'A'.repeat(900)}. ${'B'.repeat(900)}. ${'C'.repeat(900)}.`;
    const parts = splitLongSourceText(source, 1_000);
    expect(parts).toHaveLength(3);
    expect(parts.every((part) => part.length <= 1_000)).toBe(true);

    document.body.innerHTML = `<main id="root"><p>${source}</p></main>`;
    const root = document.querySelector<HTMLElement>('#root')!;
    const collected = collectPageSources(root, 'long-session');
    const record = collected.records[0]!;
    expect(record.segments.length).toBeGreaterThan(1);

    const incomplete = new Map([[record.segments[0]!.id, '第一部分。']]);
    expect(applyTranslations(root, collected.records, incomplete).applied).toBe(0);
    const complete = new Map(
      record.segments.map((segment, index) => [segment.id, `第${index + 1}部分。`]),
    );
    expect(applyTranslations(root, collected.records, complete).applied).toBe(1);
  });
});
