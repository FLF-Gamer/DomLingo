export const TRANSLATE_MENU_ID = 'domlingo-translate-current-page';
export const TRANSLATE_MENU_TITLE = 'DomLingo：AI 翻译';
const LEGACY_SELECTION_MENU_ID = 'domlingo-translate-selection';

interface ContextMenuTranslationResult {
  ok: boolean;
  code?: string;
}

export interface TranslationContextMenuDependencies {
  contextMenus: Pick<typeof chrome.contextMenus, 'create' | 'remove' | 'onClicked'>;
  onInstalled: typeof chrome.runtime.onInstalled;
  startTranslation(tabId: number): Promise<ContextMenuTranslationResult>;
  startSelectionTranslation(tabId: number): Promise<ContextMenuTranslationResult>;
  openSettings(): Promise<void>;
}

export function registerTranslationContextMenu({
  contextMenus,
  onInstalled,
  startTranslation,
  startSelectionTranslation,
  openSettings,
}: TranslationContextMenuDependencies): void {
  const recreateMenu = async (): Promise<void> => {
    await Promise.all(
      [TRANSLATE_MENU_ID, LEGACY_SELECTION_MENU_ID].map((id) =>
        contextMenus.remove(id).catch(() => undefined),
      ),
    );
    contextMenus.create({
      id: TRANSLATE_MENU_ID,
      title: TRANSLATE_MENU_TITLE,
      contexts: ['all'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  };

  onInstalled.addListener(() => {
    void recreateMenu();
  });

  contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== TRANSLATE_MENU_ID || tab?.id === undefined) return;

    let translation: Promise<ContextMenuTranslationResult>;
    if (info.selectionText) {
      if (info.editable || !info.selectionText.trim() || (info.frameId ?? 0) !== 0) return;
      translation = startSelectionTranslation(tab.id);
    } else {
      translation = startTranslation(tab.id);
    }

    void translation
      .then((response) => {
        if (!response.ok && response.code === 'CONFIG_REQUIRED') return openSettings();
        return undefined;
      })
      .catch(() => undefined);
  });
}
