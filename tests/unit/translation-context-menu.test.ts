import { describe, expect, it, vi } from 'vitest';

import {
  registerTranslationContextMenu,
  TRANSLATE_PAGE_MENU_ID,
  TRANSLATE_PAGE_MENU_TITLE,
  type TranslationContextMenuDependencies,
} from '../../src/background/translation-context-menu';

type ContextMenuClickListener = Parameters<
  TranslationContextMenuDependencies['contextMenus']['onClicked']['addListener']
>[0];
type InstalledListener = Parameters<
  TranslationContextMenuDependencies['onInstalled']['addListener']
>[0];

function setupContextMenu(
  startTranslation = vi.fn(async () => ({ ok: true })),
  openSettings = vi.fn(async () => undefined),
) {
  let installedListener: InstalledListener | undefined;
  let clickedListener: ContextMenuClickListener | undefined;
  const create = vi.fn(() => TRANSLATE_PAGE_MENU_ID);
  const remove = vi.fn(async () => undefined);

  registerTranslationContextMenu({
    contextMenus: {
      create,
      remove,
      onClicked: {
        addListener: (listener: ContextMenuClickListener) => {
          clickedListener = listener;
        },
      },
    } as unknown as TranslationContextMenuDependencies['contextMenus'],
    onInstalled: {
      addListener: (listener: InstalledListener) => {
        installedListener = listener;
      },
    } as unknown as TranslationContextMenuDependencies['onInstalled'],
    startTranslation,
    openSettings,
  });

  return {
    create,
    remove,
    startTranslation,
    openSettings,
    install: () => installedListener?.({ reason: 'install' } as chrome.runtime.InstalledDetails),
    click: (menuItemId: string | number, tabId?: number) =>
      clickedListener?.(
        { menuItemId, editable: false },
        tabId === undefined ? undefined : ({ id: tabId } as chrome.tabs.Tab),
      ),
  };
}

describe('translation context menu', () => {
  it('creates exactly one translate-page item when the extension is installed or updated', async () => {
    const contextMenu = setupContextMenu();

    contextMenu.install();

    await vi.waitFor(() => expect(contextMenu.create).toHaveBeenCalledOnce());
    expect(contextMenu.remove).toHaveBeenCalledWith(TRANSLATE_PAGE_MENU_ID);
    expect(contextMenu.create).toHaveBeenCalledWith({
      id: TRANSLATE_PAGE_MENU_ID,
      title: TRANSLATE_PAGE_MENU_TITLE,
      contexts: ['all'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });

  it('starts the existing page translation flow for the clicked tab', async () => {
    const contextMenu = setupContextMenu();

    contextMenu.click(TRANSLATE_PAGE_MENU_ID, 42);

    await vi.waitFor(() => expect(contextMenu.startTranslation).toHaveBeenCalledWith(42));
    expect(contextMenu.openSettings).not.toHaveBeenCalled();
  });

  it('opens settings when translation configuration is missing', async () => {
    const startTranslation = vi.fn(async () => ({ ok: false, code: 'CONFIG_REQUIRED' }));
    const contextMenu = setupContextMenu(startTranslation);

    contextMenu.click(TRANSLATE_PAGE_MENU_ID, 7);

    await vi.waitFor(() => expect(contextMenu.openSettings).toHaveBeenCalledOnce());
  });

  it('ignores other menu items and clicks without a tab ID', async () => {
    const contextMenu = setupContextMenu();

    contextMenu.click('another-extension-item', 1);
    contextMenu.click(TRANSLATE_PAGE_MENU_ID);
    await Promise.resolve();

    expect(contextMenu.startTranslation).not.toHaveBeenCalled();
  });
});
