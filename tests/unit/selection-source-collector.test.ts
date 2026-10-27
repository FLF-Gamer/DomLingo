import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyTranslations,
  collectSelectionSourcesAsync,
  restoreOriginals,
} from '../../src/content/source-collector';

describe('selection source collection', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('sends only the selected slice and preserves all surrounding characters on write and restore', async () => {
    document.body.innerHTML =
      '<p>Untouched prefix.  Translate this sentence.  Untouched suffix.</p>';
    const paragraph = document.querySelector('p')!;
    const target = paragraph.firstChild as Text;
    const original = target.data;
    const start = original.indexOf('  Translate');
    const end = original.indexOf('Untouched suffix.');
    const range = document.createRange();
    range.setStart(target, start);
    range.setEnd(target, end);

    const collected = (await collectSelectionSourcesAsync(range, 'selection'))!;

    expect(collected.records).toHaveLength(1);
    expect(collected.records[0]!.sourceText).toBe('Translate this sentence.');
    expect(collected.blocks[0]!.context).toBe('Translate this sentence.');
    expect(JSON.stringify(collected.blocks)).not.toContain('Untouched');
    expect(target.data).toBe(original);
    const translations = new Map([[collected.records[0]!.id, '翻译这句话。']]);
    expect(applyTranslations(collected.root, collected.records, translations).applied).toBe(1);
    expect(target.data).toBe('Untouched prefix.  翻译这句话。  Untouched suffix.');
    expect(paragraph.firstChild).toBe(target);

    expect(restoreOriginals(collected.root, collected.records).restored).toBe(1);
    expect(target.data).toBe(original);
  });

  it('clips both ends across paragraphs and links without collecting attributes or inline code', async () => {
    document.body.innerHTML = `
      <main>
        <p id="first">Skip prefix. Read <a href="/guide" title="Unselected attribute">this guide</a> with <code>fetch()</code> today.</p>
        <p id="last">Finish here. Skip suffix.</p>
        <p>Never selected paragraph.</p>
      </main>`;
    const root = document.querySelector('main')!;
    const original = root.innerHTML;
    const start = document.querySelector('#first')!.firstChild as Text;
    const end = document.querySelector('#last')!.firstChild as Text;
    const link = document.querySelector('a')!;
    const clickHandler = vi.fn();
    link.addEventListener('click', clickHandler);
    const range = document.createRange();
    range.setStart(start, 'Skip prefix. '.length);
    range.setEnd(end, 'Finish here.'.length);

    const collected = (await collectSelectionSourcesAsync(range, 'selection'))!;

    expect(collected.records.map((record) => record.sourceText)).toEqual([
      'Read',
      'this guide',
      'with',
      'today.',
      'Finish here.',
    ]);
    expect(collected.blocks).toHaveLength(2);
    expect(JSON.stringify(collected.blocks)).not.toMatch(
      /Skip|Never selected|Unselected attribute/,
    );
    const translations = new Map(
      collected.records.map((record) => [record.id, `中文:${record.sourceText}`]),
    );
    applyTranslations(collected.root, collected.records, translations);
    expect(start.data).toBe('Skip prefix. 中文:Read ');
    expect(end.data).toBe('中文:Finish here. Skip suffix.');
    expect(root.querySelector('a')).toBe(link);
    expect(link.getAttribute('href')).toBe('/guide');
    expect(link.title).toBe('Unselected attribute');
    expect(root.querySelector('code')!.textContent).toBe('fetch()');
    link.dispatchEvent(new Event('click'));
    expect(clickHandler).toHaveBeenCalledOnce();

    restoreOriginals(collected.root, collected.records);
    expect(root.innerHTML).toBe(original);
  });

  it('honors element boundary offsets at the edges of a selection', async () => {
    document.body.innerHTML =
      '<p><span>Not selected</span><b>Selected</b><i>Not selected either</i></p>';
    const paragraph = document.querySelector('p')!;
    const range = document.createRange();
    range.setStart(paragraph, 1);
    range.setEnd(paragraph, 2);

    const collected = (await collectSelectionSourcesAsync(range, 'boundaries'))!;

    expect(collected.records.map((record) => record.sourceText)).toEqual(['Selected']);
  });

  it('skips hidden and editable text within a selected range', async () => {
    document.body.innerHTML = `
      <main><p>Visible English text.</p><p hidden>Hidden English text.</p>
        <p style="visibility:hidden">Invisible English text.</p>
        <div contenteditable="">Editable English text.</div>
        <div contenteditable="plaintext-only">Editable plaintext.</div>
        <textarea>Private draft.</textarea><pre>Code example.</pre></main>`;
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('main')!);

    const collected = (await collectSelectionSourcesAsync(range, 'excluded'))!;

    expect(collected.records.map((record) => record.sourceText)).toEqual(['Visible English text.']);
    expect(collected.blocks[0]!.context).toBe('Visible English text.');
  });

  it('returns no sources for collapsed, detached and non-English selections', async () => {
    document.body.innerHTML = '<p>只有中文。</p>';
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('p')!);

    expect((await collectSelectionSourcesAsync(range, 'chinese'))!.records).toEqual([]);
    range.collapse();
    expect(await collectSelectionSourcesAsync(range, 'collapsed')).toBeUndefined();
    const detached = document.createElement('p');
    detached.textContent = 'Detached English.';
    range.selectNodeContents(detached);
    expect(await collectSelectionSourcesAsync(range, 'detached')).toBeUndefined();
  });

  it('preserves website changes made before a selected slice is translated or restored', async () => {
    document.body.innerHTML = '<p>Prefix. Translate this. Suffix.</p>';
    const target = document.querySelector('p')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(target, 8);
    range.setEnd(target, 23);
    const collected = (await collectSelectionSourcesAsync(range, 'stale'))!;
    const translations = new Map([[collected.records[0]!.id, '译文']]);

    target.data = 'New website content.';
    expect(applyTranslations(collected.root, collected.records, translations).stale).toBe(1);
    expect(target.data).toBe('New website content.');

    range.selectNodeContents(target);
    const next = (await collectSelectionSourcesAsync(range, 'restore-stale'))!;
    applyTranslations(next.root, next.records, new Map([[next.records[0]!.id, '译文']]));
    target.data = 'Website updated again.';
    expect(restoreOriginals(next.root, next.records).stale).toBe(1);
    expect(target.data).toBe('Website updated again.');
  });

  it('time-slices a large selection and can cancel collection before any DOM write', async () => {
    document.body.innerHTML = `<main>${'<p>Selected English paragraph.</p>'.repeat(120)}</main>`;
    const root = document.querySelector('main')!;
    const original = root.innerHTML;
    const range = document.createRange();
    range.selectNodeContents(root);
    const timeoutSpy = vi.spyOn(window, 'setTimeout');

    expect((await collectSelectionSourcesAsync(range, 'large', 20))!.records).toHaveLength(120);
    expect(timeoutSpy.mock.calls.length).toBeGreaterThanOrEqual(6);
    let checks = 0;
    expect(
      await collectSelectionSourcesAsync(range, 'cancel', 1, () => ++checks < 3),
    ).toBeUndefined();
    expect(root.innerHTML).toBe(original);
  });
});
