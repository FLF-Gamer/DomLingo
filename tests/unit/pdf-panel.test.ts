import { describe, expect, it, vi } from 'vitest';
import { PdfPanelSessions, routePdfContextMenu } from '../../src/background/pdf-panel';
import { isPdfPanelCommand, type PdfPanelState } from '../../src/pdf/panel-protocol';
import type { CancelSessionMessage, TranslateBatchMessage } from '../../src/messaging/protocol';

function answer(message: TranslateBatchMessage, text = '选中文字的译文') {
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

function setup(
  send = vi.fn(
    async (
      _tabId: number,
      message: TranslateBatchMessage | CancelSessionMessage,
    ): Promise<unknown> => (message.type === 'CANCEL_SESSION' ? { ok: true } : answer(message)),
  ),
) {
  const values: Record<string, unknown> = {};
  const storage = {
    get: vi.fn(async () => ({ ...values })),
    set: vi.fn(async (data: Record<string, unknown>) => {
      Object.assign(values, data);
    }),
    remove: vi.fn(async (key: string) => {
      delete values[key];
    }),
  };
  const publish = vi.fn();
  const dependencies = {
    send,
    publish,
    storage: storage as unknown as Pick<typeof chrome.storage.session, 'get' | 'set' | 'remove'>,
  };
  return {
    sessions: new PdfPanelSessions(dependencies),
    dependencies,
    storage,
    values,
    send,
    publish,
  };
}

const tab = { id: 42, windowId: 3, url: 'https://example.com/document.pdf' } as chrome.tabs.Tab;
const info = {
  menuItemId: 'domlingo-translate-current-page',
  editable: false,
  selectionText: 'Selected sentence.',
  frameId: 6,
};

function detectSource(source?: string) {
  return vi.fn<Parameters<typeof routePdfContextMenu>[2]['detect']>((_tab, _hint, receive) =>
    receive(source),
  );
}

describe('native PDF selection routing', () => {
  it('opens a side panel and translates the context-menu text without downloading or reopening the PDF', async () => {
    const { sessions, send } = setup();
    const detect = detectSource(tab.url);
    const open = vi.fn(async () => undefined);
    expect(await routePdfContextMenu(info, tab, { detect, open, sessions })).toBe(true);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(open).toHaveBeenCalledWith({ windowId: 3 });
    expect(send.mock.calls[0]![0]).toBe(42);
    expect(JSON.stringify(send.mock.calls[0]![1])).toContain('Selected sentence.');
    expect(JSON.stringify(send.mock.calls[0]![1])).not.toContain('example.com');
    expect((await sessions.get(42))?.text).toBe('选中文字的译文');
  });

  it('opens synchronously for the protected native viewer even without a PDF filename', async () => {
    const { sessions } = setup();
    const detect = detectSource();
    const open = vi.fn(async () => undefined);
    const handled = routePdfContextMenu(
      { ...info, frameUrl: 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html' },
      { ...tab, url: 'https://example.com/download/42' },
      { detect, open, sessions },
    );
    expect(open).toHaveBeenCalledOnce();
    expect(detect).not.toHaveBeenCalled();
    expect(await handled).toBe(true);
  });

  it('does not route HTML to the panel, including HTML URLs ending in .pdf', async () => {
    const { sessions } = setup();
    const open = vi.fn(async () => undefined);
    expect(await routePdfContextMenu(info, tab, { sessions, open, detect: detectSource() })).toBe(
      false,
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('shows a selection hint on empty PDF clicks and makes no model request', async () => {
    const { sessions, send } = setup();
    await routePdfContextMenu({ ...info, selectionText: '' }, tab, {
      sessions,
      open: async () => undefined,
      detect: detectSource(tab.url),
    });
    expect(send).not.toHaveBeenCalled();
    expect(await sessions.get(42)).toMatchObject({ phase: 'idle', sourceText: '' });
  });

  it('reports a failed panel open without sending a hidden translation request', async () => {
    const { sessions, send } = setup();
    await routePdfContextMenu(info, tab, {
      sessions,
      open: async () => {
        throw new Error('gesture required');
      },
      detect: detectSource(tab.url),
    });
    await vi.waitFor(async () => expect((await sessions.get(42))?.phase).toBe('error'));
    expect(send).not.toHaveBeenCalled();
  });
});

describe('PDF panel sessions', () => {
  it('translates selections longer than 20,000 characters in bounded batches', async () => {
    const { sessions, send } = setup();
    const paragraph = 'A complete sentence. '.repeat(160).trim();
    const sourceText = Array<string>(7).fill(paragraph).join('\n\n');
    const id = sessions.select(42, sourceText);
    sessions.translate(42, id);
    await vi.waitFor(async () => expect((await sessions.get(42))?.phase).toBe('completed'));
    expect((await sessions.get(42))?.sourceText).toBe(sourceText);
    expect(send).toHaveBeenCalledTimes(7);
    for (const [, message] of send.mock.calls) {
      expect(message.type).toBe('TRANSLATE_BATCH');
      if (message.type === 'TRANSLATE_BATCH')
        expect(message.payload.blocks[0]?.segments[0]?.text).toBe(paragraph);
    }
  });

  it('reports an oversized sentence without sending a truncated request', async () => {
    const { sessions, send } = setup();
    const id = sessions.select(42, 'x'.repeat(4_001));
    sessions.translate(42, id);
    expect(await sessions.get(42)).toMatchObject({
      phase: 'error',
      text: '',
      message: '单句超过 4,000 字符，请缩小选区。',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('cancels replaced selections, ignores old answers and rejects stale stop commands', async () => {
    let release: (value: unknown) => void = () => undefined;
    let first: TranslateBatchMessage | undefined;
    const send = vi.fn(
      async (
        _tabId: number,
        message: TranslateBatchMessage | CancelSessionMessage,
      ): Promise<unknown> => {
        if (message.type === 'CANCEL_SESSION') return { ok: true };
        if (!first) {
          first = message;
          return new Promise((resolve) => {
            release = resolve;
          });
        }
        return answer(message, '新译文');
      },
    );
    const { sessions, publish } = setup(send);
    const oldId = sessions.select(42, 'Old selection.');
    sessions.translate(42, oldId);
    const id = sessions.select(42, 'New selection.');
    sessions.stop(42, oldId);
    sessions.translate(42, id);
    await vi.waitFor(async () => expect((await sessions.get(42))?.text).toBe('新译文'));
    release(answer(first!, '旧译文'));
    await Promise.resolve();
    expect(publish.mock.calls.some(([, state]) => state?.text === '旧译文')).toBe(false);
    expect(send.mock.calls.some(([, message]) => message.type === 'CANCEL_SESSION')).toBe(true);
  });

  it('keeps tab states separate, stops requests on navigation and clears session storage', async () => {
    const { sessions, storage, send } = setup();
    const a = sessions.select(1, 'A');
    sessions.select(2, 'B');
    sessions.clear(1);
    sessions.translate(1, a);
    await vi.waitFor(() => expect(storage.remove).toHaveBeenCalledWith('domlingo.pdfPanel.1'));
    expect(await sessions.get(1)).toBeNull();
    expect((await sessions.get(2))?.sourceText).toBe('B');
    expect(send).not.toHaveBeenCalled();
  });

  it('restores completed results after the worker sleeps without charging for another translation', async () => {
    const { sessions, dependencies, send } = setup();
    const id = sessions.select(42, 'Remember this selection.');
    sessions.translate(42, id);
    await vi.waitFor(async () => expect((await sessions.get(42))?.phase).toBe('completed'));
    await vi.waitFor(async () => {
      const resumed = new PdfPanelSessions(dependencies);
      expect((await resumed.get(42))?.text).toBe('选中文字的译文');
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('restores interrupted translations as stopped and retries only on request', async () => {
    const { sessions, dependencies, send, values } = setup();
    const id = sessions.select(42, 'Pending selection.');
    await vi.waitFor(() => expect(values['domlingo.pdfPanel.42']).toBeTruthy());
    const resumed = new PdfPanelSessions(dependencies);
    expect((await resumed.get(42))?.phase).toBe('stopped');
    expect(send).not.toHaveBeenCalled();
    resumed.retry(42, id);
    await vi.waitFor(async () => expect((await resumed.get(42))?.phase).toBe('completed'));
  });

  it('does not resurrect a stored selection after navigation while the read is pending', async () => {
    const { dependencies } = setup();
    let release: (value: Record<string, unknown>) => void = () => undefined;
    dependencies.storage.get = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    ) as typeof dependencies.storage.get;
    const sessions = new PdfPanelSessions(dependencies);
    const pending = sessions.get(42);
    sessions.clear(42);
    release({
      'domlingo.pdfPanel.42': {
        selectionId: 'old',
        phase: 'completed',
        sourceText: 'Old document.',
        revision: 1,
      } satisfies Partial<PdfPanelState>,
    });
    expect(await pending).toBeNull();
  });

  it('validates panel commands and tab identifiers', () => {
    expect(isPdfPanelCommand({ type: 'WATCH', tabId: 7 })).toBe(true);
    expect(isPdfPanelCommand({ type: 'WATCH', tabId: -1 })).toBe(false);
    expect(isPdfPanelCommand({ type: 'WATCH', tabId: '7' })).toBe(false);
    expect(isPdfPanelCommand({ type: 'RETRY', selectionId: 'valid' })).toBe(true);
    expect(isPdfPanelCommand({ type: 'RETRY', selectionId: '' })).toBe(false);
    expect(isPdfPanelCommand({ type: 'TRANSLATE', text: 'injected' })).toBe(false);
  });
});
