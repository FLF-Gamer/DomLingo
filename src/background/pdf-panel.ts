import { PDF_SELECTION_HINT, type PdfPanelState } from '../pdf/panel-protocol';
import { PdfSelectionTranslation } from '../pdf/selection-translation';
import type { CancelSessionMessage, TranslateBatchMessage } from '../messaging/protocol';

interface PdfPanelDependencies {
  send(tabId: number, message: TranslateBatchMessage | CancelSessionMessage): Promise<unknown>;
  publish(tabId: number, state: PdfPanelState | null): void;
  storage: Pick<typeof chrome.storage.session, 'get' | 'set' | 'remove'>;
}

interface Entry {
  state: PdfPanelState;
  translation?: PdfSelectionTranslation;
}

const storageKey = (tabId: number) => `domlingo.pdfPanel.${tabId}`;

export class PdfPanelSessions {
  private readonly entries = new Map<number, Entry>();
  private readonly writes = new Map<number, Promise<void>>();
  private readonly epochs = new Map<number, number>();

  constructor(private readonly dependencies: PdfPanelDependencies) {}

  select(tabId: number, sourceText: string): string {
    const previous = this.entries.get(tabId);
    previous?.translation?.cancel();
    this.bumpEpoch(tabId);
    const text = sourceText.trim();
    const state: PdfPanelState = {
      selectionId: crypto.randomUUID(),
      sourceText: text,
      phase: text ? 'translating' : 'idle',
      text: '',
      message: text ? '正在翻译选中文字…' : PDF_SELECTION_HINT,
      revision: Math.max(Date.now(), (previous?.state.revision ?? 0) + 1),
    };
    const entry: Entry = { state };
    this.entries.set(tabId, entry);
    this.update(tabId, entry, state);
    return state.selectionId;
  }

  translate(tabId: number, selectionId: string): void {
    const entry = this.entries.get(tabId);
    if (
      !entry ||
      entry.state.selectionId !== selectionId ||
      !entry.state.sourceText ||
      entry.state.phase !== 'translating'
    )
      return;
    entry.translation?.cancel();
    entry.translation = new PdfSelectionTranslation(
      (message) => this.dependencies.send(tabId, message),
      (state) => {
        if (this.entries.get(tabId) === entry)
          this.update(tabId, entry, { ...entry.state, ...state });
      },
    );
    void entry.translation.translate(entry.state.sourceText);
  }

  retry(tabId: number, selectionId: string): void {
    const entry = this.entries.get(tabId);
    if (
      !entry ||
      entry.state.selectionId !== selectionId ||
      entry.state.phase === 'translating' ||
      !entry.state.sourceText
    )
      return;
    this.update(tabId, entry, { ...entry.state, phase: 'translating' });
    this.translate(tabId, selectionId);
  }

  stop(tabId: number, selectionId?: string): void {
    const entry = this.entries.get(tabId);
    if (
      !entry ||
      (selectionId && entry.state.selectionId !== selectionId) ||
      entry.state.phase !== 'translating'
    )
      return;
    entry.translation?.cancel();
    this.update(tabId, entry, { ...entry.state, phase: 'stopped', message: '翻译已停止。' });
  }

  fail(tabId: number, selectionId: string, message: string): void {
    const entry = this.entries.get(tabId);
    if (!entry || entry.state.selectionId !== selectionId) return;
    entry.translation?.cancel();
    this.update(tabId, entry, { ...entry.state, phase: 'error', message });
  }

  async get(tabId: number): Promise<PdfPanelState | null> {
    const existing = this.entries.get(tabId);
    if (existing) return existing.state;
    const epoch = this.epochs.get(tabId);
    const stored = await this.dependencies.storage.get(storageKey(tabId));
    if (this.epochs.get(tabId) !== epoch) return this.entries.get(tabId)?.state ?? null;
    const state = stored[storageKey(tabId)] as PdfPanelState | undefined;
    if (!state) return null;
    const entry: Entry = { state };
    this.entries.set(tabId, entry);
    if (state.phase === 'translating') {
      this.update(tabId, entry, {
        ...state,
        phase: 'stopped',
        message: '上次翻译已中断，可以重新翻译。',
      });
    }
    return entry.state;
  }

  clear(tabId: number): void {
    this.entries.get(tabId)?.translation?.cancel();
    this.entries.delete(tabId);
    this.bumpEpoch(tabId);
    this.persist(tabId, () => this.dependencies.storage.remove(storageKey(tabId)));
    this.dependencies.publish(tabId, null);
  }

  private bumpEpoch(tabId: number): void {
    this.epochs.set(tabId, (this.epochs.get(tabId) ?? 0) + 1);
  }

  private update(tabId: number, entry: Entry, state: PdfPanelState): void {
    entry.state = { ...state, revision: Math.max(Date.now(), entry.state.revision + 1) };
    const snapshot = entry.state;
    this.persist(tabId, () => this.dependencies.storage.set({ [storageKey(tabId)]: snapshot }));
    this.dependencies.publish(tabId, snapshot);
  }

  private persist(tabId: number, operation: () => Promise<void>): void {
    const pending = (this.writes.get(tabId) ?? Promise.resolve())
      .then(operation)
      .catch(() => undefined);
    this.writes.set(tabId, pending);
    void pending.then(() => {
      if (this.writes.get(tabId) === pending) this.writes.delete(tabId);
    });
  }
}

export function isNativePdfContext(info: chrome.contextMenus.OnClickData): boolean {
  return [info.frameUrl, info.pageUrl].some((url) =>
    url?.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'),
  );
}

export function routePdfContextMenu(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab,
  dependencies: {
    detect(
      tab: chrome.tabs.Tab,
      sourceHint: string | undefined,
      receive: (source: string | undefined) => void,
    ): void;
    open(options: { windowId: number }): Promise<void>;
    sessions: PdfPanelSessions;
  },
): Promise<boolean> {
  if (tab.id === undefined || info.editable) return Promise.resolve(false);
  if (isNativePdfContext(info)) {
    openPdfSelection(info, tab, dependencies);
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    dependencies.detect(tab, info.pageUrl ?? tab.url, (source) => {
      if (!source) {
        resolve(false);
        return;
      }
      openPdfSelection(info, tab, dependencies);
      resolve(true);
    });
  });
}

function openPdfSelection(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab,
  dependencies: { open(options: { windowId: number }): Promise<void>; sessions: PdfPanelSessions },
): void {
  const tabId = tab.id!;
  const selectionId = dependencies.sessions.select(tabId, info.selectionText ?? '');
  void dependencies
    .open({ windowId: tab.windowId })
    .then(() => {
      dependencies.sessions.translate(tabId, selectionId);
    })
    .catch(() => {
      dependencies.sessions.fail(
        tabId,
        selectionId,
        '无法打开译文侧栏，请点击插件图标中的“查看 PDF 译文”，再点“重新翻译”。',
      );
    });
}
