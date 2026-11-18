import { describe, expect, it } from 'vitest';
import {
  PDF_BATCH_CHARACTER_LIMIT,
  splitPdfSelection,
  type PdfSelectionChunk,
} from '../../src/pdf/selection-chunks';
import { academicAbstract } from '../fixtures/pdf-selection';

const sentence = (length: number, name = 'Sentence') =>
  `${name} ${'x'.repeat(length - name.length - 2)}.`;

function expectIntact(source: string, chunks: PdfSelectionChunk[]) {
  expect(chunks.map((chunk) => chunk.separatorBefore + chunk.text).join('')).toBe(source);
  for (const chunk of chunks) {
    expect(chunk.text.trim()).not.toBe('');
    expect(chunk.text.length).toBeLessThanOrEqual(PDF_BATCH_CHARACTER_LIMIT);
  }
}

describe('PDF selection chunks', () => {
  it.each([academicAbstract, sentence(4_000), `  ${academicAbstract}\n\nSecond paragraph.  `])(
    'keeps selections within the limit completely unchanged',
    (source) => {
      expect(splitPdfSelection(source)).toEqual([
        { text: source, separatorBefore: '', paragraphBreakBefore: false },
      ]);
    },
  );

  it('does not create a request for whitespace', () => {
    expect(splitPdfSelection(' \n\t ')).toEqual([]);
  });

  it('packs whole paragraphs up to exactly 4,000 characters including their separator', () => {
    const first = sentence(1_800);
    const second = sentence(2_198);
    const third = sentence(300);
    const source = `${first}\n\n${second}\n\n${third}`;
    const chunks = splitPdfSelection(source);
    expect(chunks.map((chunk) => chunk.text)).toEqual([`${first}\n\n${second}`, third]);
    expect(chunks.map((chunk) => chunk.paragraphBreakBefore)).toEqual([false, true]);
    expectIntact(source, chunks);
  });

  it('moves a whole paragraph to the next batch even when one of its sentences would fit', () => {
    const first = sentence(2_500);
    const second = `${sentence(1_000)} ${sentence(1_000)}`;
    const source = `${first}\n\n${second}`;
    const chunks = splitPdfSelection(source);
    expect(chunks.map((chunk) => chunk.text)).toEqual([first, second]);
    expectIntact(source, chunks);
  });

  it('splits only the oversized paragraph into complete sentences', () => {
    const first = sentence(500);
    const sentences = ['First', 'Second', 'Third', 'Fourth'].map((name) => sentence(1_800, name));
    const last = sentence(300);
    const source = `${first}\n\n${sentences.join(' ')}\n\n${last}`;
    const chunks = splitPdfSelection(source);
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      first,
      sentences.slice(0, 2).join(' '),
      `${sentences.slice(2).join(' ')}\n\n${last}`,
    ]);
    expect(chunks.map((chunk) => chunk.paragraphBreakBefore)).toEqual([false, true, false]);
    expectIntact(source, chunks);
  });

  it.each(['\n\n', '\r\n\r\n', '\r\r', '\n \t\n', '\u2029', '\u2028\u2028'])(
    'recognizes paragraph separator %j without losing text',
    (separator) => {
      const paragraphs = [sentence(2_100, 'First'), sentence(2_100, 'Second')];
      const source = paragraphs.join(separator);
      const chunks = splitPdfSelection(source);
      expect(chunks.map((chunk) => chunk.text)).toEqual(paragraphs);
      expect(chunks[1]?.paragraphBreakBefore).toBe(true);
      expectIntact(source, chunks);
    },
  );

  it.each(['\n', '\r\n', '\r', '\u2028'])(
    'does not mistake the PDF line wrap %j for a sentence or paragraph boundary',
    (separator) => {
      const longSentence = `A sentence ${'word '.repeat(420)}${separator}${'word '.repeat(420)}ends here.`;
      expect(() => splitPdfSelection(longSentence)).toThrow('单句超过 4,000 字符');
      const first = `A sentence ${'word '.repeat(200)}${separator}continues here.`;
      const source = `${first} ${sentence(3_000)}`;
      const chunks = splitPdfSelection(source);
      expect(chunks.map((chunk) => chunk.text)).toEqual([first, sentence(3_000)]);
      expect(chunks[1]?.paragraphBreakBefore).toBe(false);
      expectIntact(source, chunks);
    },
  );

  it.each([
    'Dr. Smith measured 1.7B parameters and a 29.8% improvement.',
    'Prof. Smith measured 1.7B parameters and a 29.8% improvement.',
    'Fig. 2 illustrates the result with supporting evidence.',
    'J. R. R. Tolkien wrote several books about Middle-earth.',
    'The U.S. team measured a 29.8% improvement with this model.',
  ])('keeps abbreviations and decimals inside their complete sentence: %s', (next) => {
    const first = sentence(3_990);
    const source = `${first} ${next}`;
    const chunks = splitPdfSelection(source);
    expect(chunks.map((chunk) => chunk.text)).toEqual([first, next]);
    expectIntact(source, chunks);
  });

  it('keeps quoted Chinese sentences, emoji and closing punctuation intact', () => {
    const sentences = ['甲', '乙', '丙'].map((letter) => `“${letter.repeat(1_800)}😀。”`);
    const source = sentences.join('');
    const chunks = splitPdfSelection(source);
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      sentences.slice(0, 2).join(''),
      sentences[2],
    ]);
    expect(chunks[1]?.paragraphBreakBefore).toBe(false);
    expectIntact(source, chunks);
  });

  it('does not break a sentence at punctuation inside an inline quotation', () => {
    const first = sentence(3_970);
    const next = 'He said "go!" and left the building before the rain started.';
    const source = `${first} ${next}`;
    const chunks = splitPdfSelection(source);
    expect(chunks.map((chunk) => chunk.text)).toEqual([first, next]);
    expectIntact(source, chunks);
  });

  it('handles selections longer than 20,000 characters without dropping any paragraphs', () => {
    const paragraphs = Array.from({ length: 8 }, (_, index) =>
      sentence(3_000, `Paragraph${index}`),
    );
    const source = paragraphs.join('\n\n');
    const chunks = splitPdfSelection(source);
    expect(source.length).toBeGreaterThan(20_000);
    expect(chunks.map((chunk) => chunk.text)).toEqual(paragraphs);
    expectIntact(source, chunks);
  });

  it.each([sentence(4_001), 'word, '.repeat(800), 'word; '.repeat(800), '😀'.repeat(2_001)])(
    'rejects an oversized sentence or fragment without hard-cutting it',
    (source) => {
      expect(() => splitPdfSelection(source)).toThrow('单句超过 4,000 字符');
    },
  );
});
