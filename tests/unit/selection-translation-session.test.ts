import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageTranslationSession } from '../../src/content/translation-session';
import type { TranslateBatchMessage, TranslateBatchResponse } from '../../src/messaging/protocol';

const OPTIONS = { batchCharacterLimit: 2_000, concurrency: 2 };

function selectText(target: Text, text = target.data): void {
  const start = target.data.indexOf(text);
  const range = document.createRange();
  range.setStart(target, start);
  range.setEnd(target, start + text.length);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
}

function successfulResponse(
  message: TranslateBatchMessage,
  text = '中文译文。',
): TranslateBatchResponse {
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

describe('selected-content translation sessions', () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('translates a short selection without requiring an article or sending unselected context', async () => {
    document.body.innerHTML = '<p>Private prefix. Read this sentence. Private suffix.</p>';
    const target = document.querySelector('p')!.firstChild as Text;
    const original = document.body.innerHTML;
    const batches: TranslateBatchMessage[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async (message: TranslateBatchMessage) => {
          if (message.type !== 'TRANSLATE_BATCH') return { ok: true };
          batches.push(message);
          return successfulResponse(message);
        }),
      },
    });
    selectText(target, 'Read this sentence.');
    const session = new PageTranslationSession(document);

    session.startSelection(OPTIONS);
    expect(document.getSelection()!.toString()).toBe('');
    // Subsequent selection changes must not expand the captured scope.
    selectText(target);
    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));

    expect(batches).toHaveLength(1);
    expect(batches[0]!.payload.blocks[0]!.context).toBe('Read this sentence.');
    expect(JSON.stringify(batches)).not.toContain('Private');
    expect(target.data).toBe('Private prefix. 中文译文。 Private suffix.');
    expect(session.getStatus()).toMatchObject({ total: 1, translated: 1, failed: 0 });
    session.restore();
    expect(document.body.innerHTML).toBe(original);
  });

  it('can translate several slices of the same text node and undo them in reverse order', async () => {
    document.body.innerHTML = '<p>First sentence. Second sentence. Untouched ending.</p>';
    const target = document.querySelector('p')!.firstChild as Text;
    const original = document.body.innerHTML;
    const batches: TranslateBatchMessage[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async (message: TranslateBatchMessage) => {
          if (message.type !== 'TRANSLATE_BATCH') return { ok: true };
          batches.push(message);
          return successfulResponse(message, batches.length === 1 ? '第一句。' : '第二句。');
        }),
      },
    });
    const session = new PageTranslationSession(document);
    selectText(target, 'First sentence.');
    session.startSelection(OPTIONS);
    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));
    selectText(target, 'Second sentence.');
    session.startSelection(OPTIONS);
    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));

    expect(target.data).toBe('第一句。 第二句。 Untouched ending.');
    expect(document.querySelector('p')!.childNodes).toHaveLength(1);
    expect(batches[1]!.payload.blocks[0]!.context).toBe('Second sentence.');
    expect(session.getStatus()).toMatchObject({ total: 2, translated: 2, failed: 0 });
    session.restore();
    expect(document.body.innerHTML).toBe(original);
    expect(session.getStatus()).toMatchObject({ state: 'idle', translated: 0, total: 0 });
  });

  it('preserves earlier selections when retrying the latest failed selection', async () => {
    document.body.innerHTML = '<p>First sentence.</p><p>Second sentence.</p>';
    const first = document.querySelectorAll('p')[0]!.firstChild as Text;
    const second = document.querySelectorAll('p')[1]!.firstChild as Text;
    const original = document.body.innerHTML;
    const batches: TranslateBatchMessage[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async (message: TranslateBatchMessage) => {
          if (message.type !== 'TRANSLATE_BATCH') return { ok: true };
          batches.push(message);
          return batches.length === 2
            ? { ok: false, code: 'RATE_LIMITED', message: '稍后重试。' }
            : successfulResponse(message);
        }),
      },
    });
    const session = new PageTranslationSession(document);
    selectText(first);
    session.startSelection(OPTIONS);
    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));
    selectText(second);
    session.startSelection(OPTIONS);
    await vi.waitFor(() => expect(session.getStatus().state).toBe('error'));

    expect(session.getStatus()).toMatchObject({ total: 2, translated: 1, failed: 1 });
    expect(second.data).toBe('Second sentence.');
    session.retryFailed();
    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));
    expect(session.getStatus()).toMatchObject({ total: 2, translated: 2, failed: 0 });
    expect(batches[2]!.payload.blocks[0]!.segments.map((segment) => segment.text)).toEqual([
      'Second sentence.',
    ]);
    session.restore();
    expect(document.body.innerHTML).toBe(original);
  });

  it('switches from selected slices to the whole article without a manual restore', async () => {
    document.body.innerHTML = `
      <main>
        <h1>A complete article about translating only the content you need</h1>
        <p id="first">First selected sentence. Second selected sentence. Unselected ending.</p>
        <p id="rest">Another English paragraph that must be included in whole-page translation.</p>
      </main>`;
    const root = document.querySelector('main')!;
    const original = root.innerHTML;
    const target = document.querySelector('#first')!.firstChild as Text;
    const batches: TranslateBatchMessage[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async (message: TranslateBatchMessage) => {
          if (message.type !== 'TRANSLATE_BATCH') return { ok: true };
          batches.push(message);
          return successfulResponse(message);
        }),
      },
    });
    const session = new PageTranslationSession(document);
    selectText(target, 'First selected sentence.');
    session.startSelection(OPTIONS);
    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));
    selectText(target, 'Second selected sentence.');
    session.startSelection(OPTIONS);
    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));

    document.getSelection()!.removeAllRanges();
    session.start(OPTIONS);

    await vi.waitFor(() => expect(batches).toHaveLength(3));
    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));
    expect(document.querySelector('#rest')!.textContent).toBe('中文译文。');
    expect(JSON.stringify(batches[2]!.payload.blocks)).toContain(
      'First selected sentence. Second selected sentence. Unselected ending.',
    );
    expect(JSON.stringify(batches[2]!.payload.blocks)).not.toContain('中文译文。');
    expect(session.getStatus()).toMatchObject({ total: 3, translated: 3, failed: 0 });
    session.restore();
    expect(root.innerHTML).toBe(original);
  });

  it('cancels a pending selection when switching to the whole page and ignores the late response', async () => {
    document.body.innerHTML = `
      <main><h1>An article with a deliberately slow selected-text translation</h1>
        <p id="selected">Selected English sentence. The rest of this paragraph stays readable.</p>
        <p id="rest">This additional English paragraph must also be translated on a page request.</p>
      </main>`;
    const root = document.querySelector('main')!;
    const original = root.innerHTML;
    let firstBatch: TranslateBatchMessage | undefined;
    let resolvePending: ((response: TranslateBatchResponse) => void) | undefined;
    const pending = new Promise<TranslateBatchResponse>((resolve) => {
      resolvePending = resolve;
    });
    const sendMessage = vi.fn((message: TranslateBatchMessage) => {
      if (message.type !== 'TRANSLATE_BATCH') return Promise.resolve({ ok: true });
      if (!firstBatch) {
        firstBatch = message;
        return pending;
      }
      return Promise.resolve(successfulResponse(message));
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const session = new PageTranslationSession(document);
    selectText(
      document.querySelector('#selected')!.firstChild as Text,
      'Selected English sentence.',
    );
    session.startSelection(OPTIONS);
    await vi.waitFor(() => expect(firstBatch).toBeDefined());

    session.start(OPTIONS);
    await vi.waitFor(() => expect(document.querySelector('#rest')!.textContent).toBe('中文译文。'));
    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));
    expect(sendMessage).toHaveBeenCalledWith({
      version: 1,
      type: 'CANCEL_SESSION',
      sessionId: firstBatch!.payload.sessionId,
    });
    resolvePending!(successfulResponse(firstBatch!, '迟到的局部译文。'));
    await pending;
    await Promise.resolve();
    expect(root.textContent).not.toContain('迟到的局部译文');
    expect(session.getStatus()).toMatchObject({ total: 3, translated: 3, failed: 0 });
    session.restore();
    expect(root.innerHTML).toBe(original);
  });

  it('never falls back to whole-page translation when there is no valid selection', async () => {
    document.body.innerHTML =
      '<main><p>English text must remain untouched.</p><p>只有中文。</p></main>';
    const original = document.body.innerHTML;
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const session = new PageTranslationSession(document);

    session.startSelection(OPTIONS);
    expect(session.getStatus().state).toBe('error');
    expect(session.getStatus().message).toContain('请先');
    selectText(document.querySelectorAll('p')[1]!.firstChild as Text);
    session.startSelection(OPTIONS);
    await vi.waitFor(() => expect(session.getStatus().state).toBe('error'));

    expect(sendMessage).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toBe(original);
  });

  it('keeps previous selections restorable after an unsupported selection', async () => {
    document.body.innerHTML = '<p>English sentence.</p><pre>Excluded code.</pre>';
    const original = document.body.innerHTML;
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async (message: TranslateBatchMessage) =>
          message.type === 'TRANSLATE_BATCH' ? successfulResponse(message) : { ok: true },
        ),
      },
    });
    const session = new PageTranslationSession(document);
    selectText(document.querySelector('p')!.firstChild as Text);
    session.startSelection(OPTIONS);
    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));
    selectText(document.querySelector('pre')!.firstChild as Text);
    session.startSelection(OPTIONS);
    await vi.waitFor(() => expect(session.getStatus().state).toBe('error'));

    expect(session.getStatus().translated).toBe(1);
    session.restore();
    expect(document.body.innerHTML).toBe(original);
  });

  it.each(['stop', 'restore', 'invalidateForNavigation'] as const)(
    'ignores a late selection response after %s',
    async (action) => {
      document.body.innerHTML = '<p>Prefix. Translate this. Suffix.</p>';
      const original = document.body.innerHTML;
      const target = document.querySelector('p')!.firstChild as Text;
      let resolveResponse: ((response: TranslateBatchResponse) => void) | undefined;
      let batch: TranslateBatchMessage | undefined;
      const pending = new Promise<TranslateBatchResponse>((resolve) => {
        resolveResponse = resolve;
      });
      const sendMessage = vi.fn((message: TranslateBatchMessage) => {
        if (message.type !== 'TRANSLATE_BATCH') return Promise.resolve({ ok: true });
        batch = message;
        return pending;
      });
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      const session = new PageTranslationSession(document);
      selectText(target, 'Translate this.');
      session.startSelection(OPTIONS);
      await vi.waitFor(() => expect(batch).toBeDefined());

      session[action]();
      resolveResponse!(successfulResponse(batch!));
      await pending;
      await Promise.resolve();

      expect(document.body.innerHTML).toBe(original);
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'CANCEL_SESSION' }));
    },
  );
});
