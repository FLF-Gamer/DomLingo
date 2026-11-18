export const PDF_BATCH_CHARACTER_LIMIT = 4_000;

export interface PdfSelectionChunk {
  text: string;
  separatorBefore: string;
  paragraphBreakBefore: boolean;
}

interface TextSpan {
  start: number;
  end: number;
  paragraphBreakBefore: boolean;
}

const paragraphBreak = /(?:(?:\r?\n|\r(?!\n)|\u2028)[^\S\r\n\u2028\u2029]*){2,}|\u2029+/gu;
const abbreviation =
  /(?:^|[^\p{L}\p{N}])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Fig|Figs|Eq|Eqs|Ref|Refs|Sec|Secs|Ch|Vol|No|Nos|al|cf|approx|Dept|Inc|Ltd|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Ph\.D|M\.D|B\.Sc|M\.Sc|[a-z]|(?:[a-z]\.)+[a-z])\.$/iu;
const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

function endsSentence(text: string): boolean {
  const end = text
    .trimEnd()
    .replace(/["'\p{Pe}\p{Pf}]+$/u, '')
    .trimEnd();
  return /[.!?。！？]$/u.test(end) && !/\.{2,}$/u.test(end) && !abbreviation.test(end);
}

function trimmedSpan(
  text: string,
  start: number,
  end: number,
  paragraphBreakBefore: boolean,
): TextSpan | undefined {
  const part = text.slice(start, end);
  const trimmed = part.trim();
  if (!trimmed) return undefined;
  const offset = part.length - part.trimStart().length;
  return { start: start + offset, end: start + offset + trimmed.length, paragraphBreakBefore };
}

export function splitPdfSelection(source: string): PdfSelectionChunk[] {
  if (!source.trim()) return [];
  if (source.length <= PDF_BATCH_CHARACTER_LIMIT)
    return [{ text: source, separatorBefore: '', paragraphBreakBefore: false }];

  const text = source.trim();
  const chunks: PdfSelectionChunk[] = [];
  let pending: TextSpan | undefined;
  let previousEnd = 0;

  const flush = () => {
    if (!pending) return;
    chunks.push({
      text: text.slice(pending.start, pending.end),
      separatorBefore: text.slice(previousEnd, pending.start),
      paragraphBreakBefore: chunks.length > 0 && pending.paragraphBreakBefore,
    });
    previousEnd = pending.end;
    pending = undefined;
  };

  const append = (span: TextSpan) => {
    if (span.end - span.start > PDF_BATCH_CHARACTER_LIMIT)
      throw new Error('单句超过 4,000 字符，请缩小选区。');
    if (pending && span.end - pending.start > PDF_BATCH_CHARACTER_LIMIT) flush();
    if (pending) pending.end = span.end;
    else pending = span;
  };

  const appendParagraph = (start: number, end: number) => {
    const paragraph = trimmedSpan(text, start, end, start > 0);
    if (!paragraph) return;
    if (paragraph.end - paragraph.start <= PDF_BATCH_CHARACTER_LIMIT) {
      append(paragraph);
      return;
    }
    flush();
    const original = text.slice(paragraph.start, paragraph.end);
    // PDF line wraps are not sentence boundaries; preserve original string offsets.
    const unwrapped = original.replace(/[\r\n\u2028]/gu, ' ');
    let sentenceStart = 0;
    for (const segment of sentenceSegmenter.segment(unwrapped)) {
      const candidateEnd = segment.index + segment.segment.length;
      const sentenceEnd =
        candidateEnd === unwrapped.length
          ? candidateEnd
          : sentenceStart +
            unwrapped.slice(sentenceStart, candidateEnd).replace(/[\s\p{Ps}\p{Pi}]+$/u, '').length;
      if (
        sentenceEnd < unwrapped.length &&
        (!endsSentence(unwrapped.slice(sentenceStart, sentenceEnd)) ||
          /^[\s"'\p{Ps}\p{Pi}]*\p{Ll}/u.test(unwrapped.slice(sentenceEnd)))
      )
        continue;
      const sentence = trimmedSpan(
        text,
        paragraph.start + sentenceStart,
        paragraph.start + sentenceEnd,
        sentenceStart === 0 && paragraph.paragraphBreakBefore,
      );
      if (sentence) append(sentence);
      sentenceStart = sentenceEnd;
    }
  };

  let paragraphStart = 0;
  for (const match of text.matchAll(paragraphBreak)) {
    appendParagraph(paragraphStart, match.index);
    paragraphStart = match.index + match[0].length;
  }
  appendParagraph(paragraphStart, text.length);
  flush();
  return chunks;
}
