import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectPdfSource, openPdfReader } from '../../src/background/pdf-reader';

function setup(url: string, probe: string | null | Error) {
  const create = vi.fn(async (details: { url: string; index: number; windowId: number }) => ({
    id: 8,
    ...details,
  }));
  const executeScript = vi.fn(async () => {
    if (probe instanceof Error) throw probe;
    return [{ result: probe }];
  });
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    tabs: { get: vi.fn(async () => ({ id: 7, url, index: 2, windowId: 4 })), create },
    scripting: { executeScript },
  });
  return { create, executeScript };
}

afterEach(() => vi.unstubAllGlobals());

describe('PDF reader routing', () => {
  it('does not mistake an HTML page ending in .pdf for a PDF', async () => {
    setup('https://example.com/help.pdf', null);
    expect(await detectPdfSource(7)).toBeUndefined();
  });
  it('recognizes MIME evidence without a PDF filename', async () => {
    setup('https://example.com/download/1', 'https://example.com/download/1');
    expect(await detectPdfSource(7)).toBe('https://example.com/download/1');
  });
  it('uses the URL hint when the native viewer blocks script injection', async () => {
    setup('https://example.com/guide.pdf#page=2', new Error('Cannot access this page'));
    expect(await detectPdfSource(7)).toBe('https://example.com/guide.pdf#page=2');
  });
  it('preserves a suffix-free source for explicit opening and stays in the same window', async () => {
    const { create } = setup(
      'https://example.com/download/1',
      new Error('Cannot access this page'),
    );
    await openPdfReader(7);
    expect(create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/pdf.html#source=https%3A%2F%2Fexample.com%2Fdownload%2F1',
      index: 3,
      windowId: 4,
    });
  });
  it('does not transfer unsupported or credential-bearing URLs to the reader', async () => {
    const { create } = setup('file:///private/document.pdf', new Error('Cannot access this page'));
    await openPdfReader(7);
    expect(create.mock.calls[0]![0]).toMatchObject({ url: 'chrome-extension://test/pdf.html' });
  });
});
