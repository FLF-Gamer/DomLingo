export const TRANSLATE_PAGE_MENU_ID = 'domlingo-translate-current-page';
export const TRANSLATE_PAGE_MENU_TITLE = 'DomLingo：AI 翻译当前页面';

interface ContextMenuTranslationResult {
  ok: boolean;
  code?: string;
}

export interface TranslationContextMenuDependencies {
  contextMenus: Pick<typeof chrome.contextMenus, 'create' | 'remove' | 'onClicked'>;
  onInstalled: typeof chrome.runtime.onInstalled;
  startTranslation(tabId: number): Promise<ContextMenuTranslationResult>;
  openSettings(): Promise<void>;
}

export function registerTranslationContextMenu({
  contextMenus,
  onInstalled,
  startTranslation,
  openSettings,
}: TranslationContextMenuDependencies): void {
  const recreateMenu = async (): Promise<void> => {
    await contextMenus.remove(TRANSLATE_PAGE_MENU_ID).catch(() => undefined);
    contextMenus.create({
      id: TRANSLATE_PAGE_MENU_ID,
      title: TRANSLATE_PAGE_MENU_TITLE,
      contexts: ['all'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  };

  onInstalled.addListener(() => {
    void recreateMenu();
  });

  contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== TRANSLATE_PAGE_MENU_ID || tab?.id === undefined) return;

    void startTranslation(tab.id)
      .then((response) => {
        if (!response.ok && response.code === 'CONFIG_REQUIRED') return openSettings();
        return undefined;
      })
      .catch(() => undefined);
  });
}
