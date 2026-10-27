import { describe, expect, it, vi } from 'vitest';

import {
  registerTranslationContextMenu,
  TRANSLATE_MENU_ID,
  TRANSLATE_MENU_TITLE,
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
  startSelectionTranslation = vi.fn(async () => ({ ok: true })),
) {
  let installedListener: InstalledListener | undefined;
  let clickedListener: ContextMenuClickListener | undefined;
  const create = vi.fn(() => TRANSLATE_MENU_ID);
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
    startSelectionTranslation,
    openSettings,
  });

  return {
    create,
    remove,
    startTranslation,
    startSelectionTranslation,
    openSettings,
    install: () => installedListener?.({ reason: 'install' } as chrome.runtime.InstalledDetails),
    click: (
      menuItemId: string | number,
      tabId?: number,
      info: Partial<chrome.contextMenus.OnClickData> = {},
    ) =>
      clickedListener?.(
        { menuItemId, editable: false, ...info },
        tabId === undefined ? undefined : ({ id: tabId } as chrome.tabs.Tab),
      ),
  };
}

describe('translation context menu', () => {
  it('creates exactly one top-level action and removes the legacy selection item', async () => {
    const contextMenu = setupContextMenu();

    contextMenu.install();

    await vi.waitFor(() => expect(contextMenu.create).toHaveBeenCalledOnce());
    expect(contextMenu.remove).toHaveBeenCalledWith(TRANSLATE_MENU_ID);
    expect(contextMenu.remove).toHaveBeenCalledWith('domlingo-translate-selection');
    expect(TRANSLATE_MENU_TITLE).toBe('DomLingo：AI 翻译');
    expect(contextMenu.create).toHaveBeenCalledWith({
      id: TRANSLATE_MENU_ID,
      title: TRANSLATE_MENU_TITLE,
      contexts: ['all'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });

  it('starts the existing page translation flow for the clicked tab', async () => {
    const contextMenu = setupContextMenu();

    contextMenu.click(TRANSLATE_MENU_ID, 42);

    await vi.waitFor(() => expect(contextMenu.startTranslation).toHaveBeenCalledWith(42));
    expect(contextMenu.openSettings).not.toHaveBeenCalled();
    expect(contextMenu.startSelectionTranslation).not.toHaveBeenCalled();
  });

  it('keeps page translation available on links and images when there is no selection', async () => {
    const contextMenu = setupContextMenu();

    contextMenu.click(TRANSLATE_MENU_ID, 42, { linkUrl: 'https://example.com/article' });
    contextMenu.click(TRANSLATE_MENU_ID, 43, { mediaType: 'image' });

    await vi.waitFor(() => expect(contextMenu.startTranslation).toHaveBeenCalledTimes(2));
    expect(contextMenu.startTranslation).toHaveBeenCalledWith(42);
    expect(contextMenu.startTranslation).toHaveBeenCalledWith(43);
    expect(contextMenu.startSelectionTranslation).not.toHaveBeenCalled();
  });

  it('uses page translation after a selection click when Chrome supplies an empty selection string', async () => {
    const contextMenu = setupContextMenu();

    contextMenu.click(TRANSLATE_MENU_ID, 42, { selectionText: 'Selected sentence.' });
    await vi.waitFor(() => expect(contextMenu.startSelectionTranslation).toHaveBeenCalledOnce());
    contextMenu.click(TRANSLATE_MENU_ID, 42, { selectionText: '' });

    await vi.waitFor(() => expect(contextMenu.startTranslation).toHaveBeenCalledWith(42));
    expect(contextMenu.startSelectionTranslation).toHaveBeenCalledOnce();
  });

  it('translates the selection without starting whole-page translation', async () => {
    const contextMenu = setupContextMenu();

    contextMenu.click(TRANSLATE_MENU_ID, 42, { selectionText: 'Selected sentence.' });

    await vi.waitFor(() => expect(contextMenu.startSelectionTranslation).toHaveBeenCalledWith(42));
    expect(contextMenu.startTranslation).not.toHaveBeenCalled();
    expect(contextMenu.openSettings).not.toHaveBeenCalled();
  });

  it('opens settings for a selection when model configuration is missing', async () => {
    const startSelectionTranslation = vi.fn(async () => ({ ok: false, code: 'CONFIG_REQUIRED' }));
    const contextMenu = setupContextMenu(undefined, undefined, startSelectionTranslation);

    contextMenu.click(TRANSLATE_MENU_ID, 7, { selectionText: 'Selected sentence.' });

    await vi.waitFor(() => expect(contextMenu.openSettings).toHaveBeenCalledOnce());
    expect(contextMenu.startTranslation).not.toHaveBeenCalled();
  });

  it('ignores whitespace-only, editable and subframe selections instead of translating the main page', () => {
    const contextMenu = setupContextMenu();

    contextMenu.click(TRANSLATE_MENU_ID, 42, { selectionText: '   ' });
    contextMenu.click(TRANSLATE_MENU_ID, 42, {
      selectionText: 'Editable value.',
      editable: true,
    });
    contextMenu.click(TRANSLATE_MENU_ID, 42, {
      selectionText: 'Subframe selection.',
      frameId: 5,
    });
    contextMenu.click(TRANSLATE_MENU_ID, undefined, { selectionText: 'No tab.' });

    expect(contextMenu.startSelectionTranslation).not.toHaveBeenCalled();
    expect(contextMenu.startTranslation).not.toHaveBeenCalled();
  });

  it('opens settings when translation configuration is missing', async () => {
    const startTranslation = vi.fn(async () => ({ ok: false, code: 'CONFIG_REQUIRED' }));
    const contextMenu = setupContextMenu(startTranslation);

    contextMenu.click(TRANSLATE_MENU_ID, 7);

    await vi.waitFor(() => expect(contextMenu.openSettings).toHaveBeenCalledOnce());
  });

  it('ignores other menu items and clicks without a tab ID', async () => {
    const contextMenu = setupContextMenu();

    contextMenu.click('another-extension-item', 1);
    contextMenu.click('domlingo-translate-selection', 1, { selectionText: 'Legacy click.' });
    contextMenu.click(TRANSLATE_MENU_ID);
    await Promise.resolve();

    expect(contextMenu.startTranslation).not.toHaveBeenCalled();
    expect(contextMenu.startSelectionTranslation).not.toHaveBeenCalled();
  });
});
