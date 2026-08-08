import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageTranslationSession } from '../../src/content/translation-session';
import type { TranslateBatchMessage } from '../../src/messaging/protocol';

describe('PageTranslationSession', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('translates collected nodes and restores their exact originals', async () => {
    document.body.innerHTML = `
      <main>
        <h1>A complete translation workflow</h1>
        <p>This paragraph contains enough English text for the main content detector.</p>
        <p>The second paragraph verifies that several nodes can be translated safely.</p>
      </main>
    `;
    const originalHtml = document.querySelector('main')!.innerHTML;
    const sendMessage = vi.fn(async (message: TranslateBatchMessage) => ({
      ok: true,
      result: {
        translations: message.payload.blocks.flatMap((block) =>
          block.segments.map((segment) => ({ id: segment.id, text: `中文:${segment.text}` })),
        ),
        failedIds: [],
        failures: [],
      },
    }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const session = new PageTranslationSession(document);
    session.start({ batchCharacterLimit: 4_000, concurrency: 2 });

    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));
    expect(session.getStatus().translated).toBeGreaterThan(0);
    expect(document.querySelector('main')?.textContent).toContain('中文:');

    session.restore();
    expect(document.querySelector('main')?.innerHTML).toBe(originalHtml);
  });

  it('applies valid sibling nodes when another result is missing', async () => {
    document.body.innerHTML = `
      <main>
        <h1>A reliable partial translation example</h1>
        <p>This first paragraph should receive a valid translated result.</p>
        <p>This second paragraph deliberately remains untranslated after a node failure.</p>
      </main>
    `;
    const sendMessage = vi.fn(async (message: TranslateBatchMessage) => {
      const segments = message.payload.blocks.flatMap((block) => block.segments);
      return {
        ok: true,
        result: {
          translations: [{ id: segments[1]!.id, text: '部分有效译文。' }],
          failedIds: segments.filter((_segment, index) => index !== 1).map((segment) => segment.id),
          failures: segments
            .filter((_segment, index) => index !== 1)
            .map((segment) => ({ id: segment.id, reason: 'MISSING_ID' as const })),
        },
      };
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const session = new PageTranslationSession(document);
    session.start({ batchCharacterLimit: 4_000, concurrency: 1 });

    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));
    expect(session.getStatus().translated).toBe(1);
    expect(session.getStatus().failed).toBeGreaterThan(0);
    expect(session.getStatus().failureDetails.MISSING_ID).toBeGreaterThan(0);
    expect(session.getStatus().message).toContain('模型漏回 ID');
    expect(document.querySelector('main')?.textContent).toContain('部分有效译文。');
    expect(document.querySelector('main')?.textContent).toContain(
      'This second paragraph deliberately remains untranslated after a node failure.',
    );
  });

  it('does not write a late batch response after the user stops translation', async () => {
    document.body.innerHTML = `
      <main>
        <h1>A cancellable translation workflow</h1>
        <p>This paragraph waits for a deliberately delayed model response.</p>
        <p>Stopping the session must keep every original node unchanged.</p>
      </main>
    `;
    const originalText = document.querySelector('main')!.textContent;
    let pendingMessage: TranslateBatchMessage | undefined;
    let resolveBatch: ((response: unknown) => void) | undefined;
    const batchPromise = new Promise((resolve) => {
      resolveBatch = resolve;
    });
    const sendMessage = vi.fn((message: { type?: string }) => {
      if (message.type === 'TRANSLATE_BATCH') {
        pendingMessage = message as TranslateBatchMessage;
        return batchPromise;
      }
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const session = new PageTranslationSession(document);
    session.start({ batchCharacterLimit: 4_000, concurrency: 1 });
    await vi.waitFor(() => expect(pendingMessage).toBeDefined());
    session.stop();

    const translations = pendingMessage!.payload.blocks.flatMap((block) =>
      block.segments.map((segment) => ({ id: segment.id, text: '不应写入的迟到译文' })),
    );
    resolveBatch?.({ ok: true, result: { translations, failedIds: [], failures: [] } });
    await Promise.resolve();

    expect(session.getStatus().state).toBe('stopped');
    expect(document.querySelector('main')?.textContent).toBe(originalText);
  });

  it('does not start translation after the user stops during a time-sliced scan', async () => {
    document.body.innerHTML = `<main><h1>A large cancellable article</h1>${Array.from(
      { length: 300 },
      (_value, index) => `<p>Paragraph ${index} contains enough English text for scanning.</p>`,
    ).join('')}</main>`;
    const originalText = document.querySelector('main')!.textContent;
    const sendMessage = vi.fn(async (message: { type?: string }) => {
      void message;
      return { ok: true };
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const session = new PageTranslationSession(document);
    session.start({ batchCharacterLimit: 4_000, concurrency: 1 });
    expect(session.getStatus().state).toBe('scanning');
    session.stop();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(session.getStatus().state).toBe('stopped');
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'TRANSLATE_BATCH')).toBe(
      false,
    );
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'CANCEL_SESSION' }));
    expect(document.querySelector('main')?.textContent).toBe(originalText);
  });

  it('reports a provider batch failure separately from missing model IDs', async () => {
    document.body.innerHTML = `
      <main>
        <h1>A rate limited translation request</h1>
        <p>This paragraph remains unchanged when the provider rejects its batch.</p>
      </main>
    `;
    const sendMessage = vi.fn(async (message: { type?: string }) => {
      if (message.type === 'TRANSLATE_BATCH') {
        return {
          ok: false,
          code: 'RATE_LIMITED',
          message: '模型服务请求过于频繁，请稍后重试。',
        };
      }
      return { ok: true };
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const session = new PageTranslationSession(document);
    session.start({ batchCharacterLimit: 4_000, concurrency: 1 });

    await vi.waitFor(() => expect(session.getStatus().state).toBe('error'));
    expect(session.getStatus().failureDetails).toEqual({ RATE_LIMITED: 2 });
    expect(session.getStatus().message).toContain('服务限流 2');
    expect(session.getStatus().failureDetails.MISSING_ID).toBeUndefined();
  });

  it('buffers concurrent responses and writes batches in page order', async () => {
    document.body.innerHTML = `<main>${Array.from(
      { length: 30 },
      (_value, index) => `<p>Ordered paragraph ${index + 1} contains translatable English.</p>`,
    ).join('')}</main>`;
    const originalText = document.querySelector('main')!.textContent;
    const statusSnapshots: number[] = [];
    const translatedParagraphSnapshots: number[][] = [];
    const messages: TranslateBatchMessage[] = [];
    let resolveFirst: ((response: unknown) => void) | undefined;
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const responseFor = (message: TranslateBatchMessage) => ({
      ok: true,
      result: {
        translations: message.payload.blocks.flatMap((block) =>
          block.segments.map((segment) => ({ id: segment.id, text: `译文:${segment.text}` })),
        ),
        failedIds: [],
        failures: [],
      },
    });
    const sendMessage = vi.fn((message: { type?: string }) => {
      if (message.type !== 'TRANSLATE_BATCH') return Promise.resolve({ ok: true });
      const batch = message as TranslateBatchMessage;
      messages.push(batch);
      return messages.length === 1 ? firstResponse : Promise.resolve(responseFor(batch));
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const session = new PageTranslationSession(document, (status) => {
      if (status.state === 'translating') {
        statusSnapshots.push(status.translated);
        translatedParagraphSnapshots.push(
          [...document.querySelectorAll('p')].flatMap((paragraph, index) =>
            paragraph.textContent?.startsWith('译文:') ? [index] : [],
          ),
        );
      }
    });
    session.start({ batchCharacterLimit: 2_000, concurrency: 3 });
    await vi.waitFor(() => expect(messages.length).toBeGreaterThan(1));
    await Promise.resolve();

    expect(document.querySelector('main')?.textContent).toBe(originalText);
    resolveFirst?.(responseFor(messages[0]!));
    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));

    const committed = statusSnapshots.filter((count) => count > 0);
    expect(committed).toEqual([...committed].sort((left, right) => left - right));
    for (const snapshot of translatedParagraphSnapshots) {
      expect(snapshot).toEqual(Array.from({ length: snapshot.length }, (_value, index) => index));
    }
    expect(session.getStatus().translated).toBe(30);
  });

  it('retries only records that are still untranslated', async () => {
    document.body.innerHTML = `
      <main>
        <h1>A retryable article title</h1>
        <p>The first retryable paragraph.</p>
        <p>The second retryable paragraph.</p>
      </main>
    `;
    const messages: TranslateBatchMessage[] = [];
    let successfulId = '';
    const sendMessage = vi.fn(async (message: { type?: string }) => {
      if (message.type !== 'TRANSLATE_BATCH') return { ok: true };
      const batch = message as TranslateBatchMessage;
      messages.push(batch);
      const segments = batch.payload.blocks.flatMap((block) => block.segments);
      if (messages.length === 1) {
        successfulId = segments[0]!.id;
        return {
          ok: true,
          result: {
            translations: [{ id: successfulId, text: '首次成功译文。' }],
            failedIds: segments.slice(1).map((segment) => segment.id),
            failures: segments
              .slice(1)
              .map((segment) => ({ id: segment.id, reason: 'INVALID_RESPONSE' as const })),
          },
        };
      }
      return responseForRetry(batch);
    });
    const responseForRetry = (message: TranslateBatchMessage) => ({
      ok: true,
      result: {
        translations: message.payload.blocks.flatMap((block) =>
          block.segments.map((segment) => ({ id: segment.id, text: '重试成功译文。' })),
        ),
        failedIds: [],
        failures: [],
      },
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const session = new PageTranslationSession(document);
    session.start({ batchCharacterLimit: 4_000, concurrency: 1 });
    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));
    expect(session.getStatus()).toMatchObject({ translated: 1, failed: 2 });

    session.retryFailed();
    expect(session.getStatus().state).toBe('translating');
    await vi.waitFor(() => expect(session.getStatus().state).toBe('completed'));
    expect(session.getStatus().failed).toBe(0);
    expect(session.getStatus().translated).toBe(3);
    const retryIds = messages[1]!.payload.blocks.flatMap((block) =>
      block.segments.map((segment) => segment.id),
    );
    expect(retryIds).not.toContain(successfulId);
    expect(retryIds).toHaveLength(2);
  });
});
