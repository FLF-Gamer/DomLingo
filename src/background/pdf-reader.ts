import { looksLikePdfUrl, pdfSourceUrl } from '../pdf/source';

function readPdfDocumentSource(): string | null {
  if (document.contentType === 'application/pdf') return location.href;
  const embedded = document.querySelector<HTMLObjectElement | HTMLEmbedElement>(
    'embed[type="application/pdf"], object[type="application/pdf"]',
  );
  if (embedded && (document.body?.innerText.trim().length ?? 0) < 100) {
    const source = embedded.getAttribute('src') ?? embedded.getAttribute('data');
    return source ? new URL(source, location.href).href : location.href;
  }
  return null;
}

export function detectPdfInContextMenu(
  tab: chrome.tabs.Tab,
  sourceHint: string | undefined,
  receive: (source: string | undefined) => void,
): void {
  const candidate = tab.url ?? sourceHint;
  if (tab.id === undefined || candidate?.startsWith(chrome.runtime.getURL('pdf.html'))) {
    receive(undefined);
    return;
  }
  // Keep the side-panel open inside Chrome's API callback so it retains the user's gesture.
  chrome.scripting.executeScript(
    { target: { tabId: tab.id }, func: readPdfDocumentSource },
    (results) => {
      const failed = chrome.runtime.lastError;
      const result = results?.[0]?.result;
      receive(
        !failed && result === null
          ? undefined
          : typeof result === 'string'
            ? result
            : candidate && looksLikePdfUrl(candidate)
              ? candidate
              : undefined,
      );
    },
  );
}

export async function detectPdfSource(
  tabId: number,
  sourceHint?: string,
): Promise<string | undefined> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url?.startsWith(chrome.runtime.getURL('pdf.html'))) return undefined;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readPdfDocumentSource,
    });
    if (typeof result?.result === 'string') return result.result;
    if (result?.result === null) return undefined;
  } catch {
    // The native PDF viewer does not expose a scriptable document.
  }
  const candidate = tab.url ?? sourceHint;
  return candidate && looksLikePdfUrl(candidate) ? candidate : undefined;
}

export async function openPdfReader(tabId: number, source?: string): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const candidate = source ?? (await detectPdfSource(tabId)) ?? tab.url;
  const url = new URL(chrome.runtime.getURL('pdf.html'));
  if (candidate && pdfSourceUrl(candidate))
    url.hash = new URLSearchParams({ source: candidate }).toString();
  await chrome.tabs.create({ url: url.href, index: tab.index + 1, windowId: tab.windowId });
}
