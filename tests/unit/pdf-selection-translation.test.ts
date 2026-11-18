import { describe, expect, it, vi } from 'vitest';
import {
  isTranslateBatchMessage,
  type TranslateBatchMessage,
  type CancelSessionMessage,
} from '../../src/messaging/protocol';
import { academicAbstract } from '../fixtures/pdf-selection';
import {
  PdfSelectionTranslation,
  type PdfTranslationState,
} from '../../src/pdf/selection-translation';

function answer(message: TranslateBatchMessage, text = '译文') {
  return {
    ok: true,
    result: {
      translations: message.payload.blocks.flatMap((block) =>
        block.segments.map((segment) => ({ id: segment.id, text })),
      ),
      failedIds: [],
      failures: [],
    },
  };
}

function successfulSend(text = '译文') {
  return vi.fn(async (message: TranslateBatchMessage | CancelSessionMessage) =>
    message.type === 'TRANSLATE_BATCH' ? answer(message, text) : { ok: true },
  );
}

function firstRequest(send: ReturnType<typeof successfulSend>): TranslateBatchMessage {
  const message = send.mock.calls[0]?.[0];
  if (!isTranslateBatchMessage(message)) throw new Error('Expected a valid translation request.');
  return message;
}

describe('PDF selected-text translation', () => {
  it('sends the supplied selection without duplicating it into context', async () => {
    const send = vi.fn(async (message) => answer(message as TranslateBatchMessage));
    const update = vi.fn();
    await new PdfSelectionTranslation(send, update).translate('The selected sentence.');
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0].payload.blocks).toEqual([
      {
        id: 'pdf-selection',
        context: '',
        segments: [{ id: 'pdf-selection-text', text: 'The selected sentence.' }],
      },
    ]);
    expect(update).toHaveBeenLastCalledWith({
      phase: 'completed',
      text: '译文',
      message: '翻译完成',
    });
  });
  it('keeps a complete academic abstract in a single request and returns one unchanged translation', async () => {
    const translated =
      '提示值表记录先前的指导与反馈，通过冷却机制和 token 预算检查来减少重复建议。';
    const send = successfulSend(translated);
    const update = vi.fn();
    await new PdfSelectionTranslation(send, update).translate(academicAbstract);
    expect(academicAbstract.length).toBe(1_099);
    expect(send).toHaveBeenCalledOnce();
    const request = firstRequest(send);
    expect(isTranslateBatchMessage(request)).toBe(true);
    expect(request.payload.blocks).toHaveLength(1);
    expect(request.payload.blocks[0]!.segments).toEqual([
      { id: 'pdf-selection-text', text: academicAbstract },
    ]);
    expect(update).toHaveBeenLastCalledWith({
      phase: 'completed',
      text: translated,
      message: '翻译完成',
    });
  });

  it('preserves source and translated paragraph breaks without adding its own separators', async () => {
    const source = `${'A complete sentence. '.repeat(100)}\n\nSecond paragraph.\nAnother line.`;
    const translated = '第一段译文。\n\n第二段译文。\n另一行。';
    const send = successfulSend(translated);
    const update = vi.fn();
    await new PdfSelectionTranslation(send, update).translate(source);
    expect(send).toHaveBeenCalledOnce();
    expect(firstRequest(send).payload.blocks[0]!.segments[0]!.text).toBe(source);
    expect(update).toHaveBeenLastCalledWith({
      phase: 'completed',
      text: translated,
      message: '翻译完成',
    });
  });

  it.each([
    ['maximum single batch', 'x'.repeat(4_000)],
    ['Unicode text', `${'a'.repeat(799)}😀 suggestions remain intact.`],
  ])('sends %s as one valid, unsplit request', async (_label, source) => {
    const send = successfulSend();
    await new PdfSelectionTranslation(send, vi.fn()).translate(source);
    expect(send).toHaveBeenCalledOnce();
    const request = firstRequest(send);
    expect(isTranslateBatchMessage(request)).toBe(true);
    expect(request.payload.blocks).toHaveLength(1);
    expect(request.payload.blocks[0]!.segments).toEqual([
      { id: 'pdf-selection-text', text: source },
    ]);
  });

  it('reports an incomplete response without falling back to smaller fragments', async () => {
    const send = vi.fn(async () => ({
      ok: true,
      result: {
        translations: [],
        failedIds: ['pdf-selection-text'],
        failures: [{ id: 'pdf-selection-text', reason: 'OUTPUT_TRUNCATED' }],
      },
    }));
    const update = vi.fn();
    await new PdfSelectionTranslation(send, update).translate(academicAbstract);
    expect(send).toHaveBeenCalledOnce();
    expect(update).toHaveBeenLastCalledWith({
      phase: 'error',
      text: '',
      message: '模型没有返回完整译文，请重试或缩小选区。',
    });
  });
  it('preflights every sentence before sending any request', async () => {
    const send = vi.fn();
    const update = vi.fn();
    const translator = new PdfSelectionTranslation(send, update);
    await translator.translate('');
    expect(update.mock.calls[0]![0].message).toContain('扫描件');
    await translator.translate(`A valid paragraph.\n\n${'a'.repeat(4_001)}.`);
    expect(send).not.toHaveBeenCalled();
    expect(update).toHaveBeenLastCalledWith({
      phase: 'error',
      text: '',
      message: '单句超过 4,000 字符，请缩小选区。',
    });
  });

  it('translates long selections sequentially in valid paragraph-sized requests with progress', async () => {
    const paragraphs = Array.from({ length: 7 }, (_, index) =>
      `${index}: ${'A complete sentence. '.repeat(160)}`.trim(),
    );
    const source = paragraphs.join('\n\n');
    const requests: TranslateBatchMessage[] = [];
    const send = vi.fn(async (message: TranslateBatchMessage | CancelSessionMessage) => {
      if (message.type === 'CANCEL_SESSION') return { ok: true };
      requests.push(message);
      return answer(message, `第${requests.length}段译文。`);
    });
    const update = vi.fn();
    await new PdfSelectionTranslation(send, update).translate(source);
    expect(source.length).toBeGreaterThan(20_000);
    expect(requests).toHaveLength(paragraphs.length);
    expect(new Set(requests.map((request) => request.payload.sessionId)).size).toBe(1);
    expect(new Set(requests.map((request) => request.payload.requestId)).size).toBe(7);
    requests.forEach((request, index) => {
      expect(isTranslateBatchMessage(request)).toBe(true);
      expect(request.payload.blocks).toHaveLength(1);
      expect(request.payload.blocks[0]!.context).toBe('');
      expect(request.payload.blocks[0]!.segments).toHaveLength(1);
      expect(request.payload.blocks[0]!.segments[0]!.text).toBe(paragraphs[index]);
      expect(request.payload.blocks[0]!.segments[0]!.text.length).toBeLessThanOrEqual(4_000);
    });
    expect(update).toHaveBeenCalledWith({
      phase: 'translating',
      text: '第1段译文。',
      message: '正在翻译 1/7…',
    });
    expect(update).toHaveBeenLastCalledWith({
      phase: 'completed',
      text: paragraphs.map((_, index) => `第${index + 1}段译文。`).join('\n\n'),
      message: '翻译完成',
    });
  });

  it.each([
    [['第一句译文。\n\n', '\n\n第二句译文。'], '第一句译文。第二句译文。'],
    [['First result.', 'Second result.'], 'First result. Second result.'],
  ])(
    'joins sentence batches without introducing a paragraph break',
    async (translations, expected) => {
      let index = 0;
      const send = vi.fn(async (message: TranslateBatchMessage | CancelSessionMessage) =>
        message.type === 'TRANSLATE_BATCH' ? answer(message, translations[index++]) : { ok: true },
      );
      const update = vi.fn();
      const source = `${'First sentence word '.repeat(110)}ends. ${'Second sentence word '.repeat(110)}ends.`;
      await new PdfSelectionTranslation(send, update).translate(source);
      expect(send).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenLastCalledWith({
        phase: 'completed',
        text: expected,
        message: '翻译完成',
      });
    },
  );

  it('keeps completed translations if a later batch fails and does not send further batches', async () => {
    let count = 0;
    const send = vi.fn(async (message: TranslateBatchMessage | CancelSessionMessage) => {
      if (message.type === 'CANCEL_SESSION') return { ok: true };
      return ++count === 1
        ? answer(message, '已完成的译文。')
        : { ok: false, message: '连接失败。' };
    });
    const update = vi.fn();
    const paragraph = 'A complete sentence. '.repeat(160).trim();
    await new PdfSelectionTranslation(send, update).translate(
      [paragraph, paragraph, paragraph].join('\n\n'),
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith({
      phase: 'error',
      text: '已完成的译文。',
      message: '连接失败。',
    });
  });
  it('cancels a previous region and ignores its late response', async () => {
    let release: (value: unknown) => void = () => undefined;
    let oldMessage: TranslateBatchMessage | undefined;
    const send = vi.fn(async (message) => {
      if (message.type === 'CANCEL_SESSION') return { ok: true };
      if (!oldMessage) {
        oldMessage = message;
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return answer(message, '新选区译文');
    });
    const updates: PdfTranslationState[] = [];
    const translator = new PdfSelectionTranslation(send, (state) => updates.push(state));
    const old = translator.translate('First region.');
    await translator.translate('Second region.');
    release(answer(oldMessage!, '过期译文'));
    await old;
    expect(send.mock.calls.some(([message]) => message.type === 'CANCEL_SESSION')).toBe(true);
    expect(updates.at(-1)?.text).toBe('新选区译文');
    expect(updates.some((state) => state.text.includes('过期'))).toBe(false);
  });
  it('cancels a pending batch, ignores its late result and never sends subsequent batches', async () => {
    let release: (value: unknown) => void = () => undefined;
    let request: TranslateBatchMessage | undefined;
    const send = vi.fn(async (message) => {
      if (message.type === 'CANCEL_SESSION') return { ok: true };
      request = message;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const update = vi.fn();
    const translator = new PdfSelectionTranslation(send, update);
    const pending = translator.translate('A complete sentence. '.repeat(600));
    translator.cancel();
    release(answer(request!));
    await pending;
    expect(send.mock.calls.filter(([message]) => message.type === 'TRANSLATE_BATCH')).toHaveLength(
      1,
    );
    expect(update).toHaveBeenCalledOnce();
  });

  it('allows cancellation between batches without sending another request', async () => {
    const send = successfulSend('第一部分译文。');
    const updates: PdfTranslationState[] = [];
    const translator = new PdfSelectionTranslation(send, (state) => {
      updates.push(state);
      if (state.text) translator.cancel();
    });
    await translator.translate('A complete sentence. '.repeat(600));
    expect(send.mock.calls.filter(([message]) => message.type === 'TRANSLATE_BATCH')).toHaveLength(
      1,
    );
    expect(updates.at(-1)).toMatchObject({ phase: 'translating', text: '第一部分译文。' });
  });
});
