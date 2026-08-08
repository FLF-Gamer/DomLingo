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
});
