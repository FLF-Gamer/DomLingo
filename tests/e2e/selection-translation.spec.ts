import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  registerTranslationContextMenu,
  TRANSLATE_MENU_ID,
  type TranslationContextMenuDependencies,
} from '../../src/background/translation-context-menu';
import type {
  ContentCommandMessage,
  PageTranslationStatus,
  TranslateBatchMessage,
} from '../../src/messaging/protocol';

interface SelectionHarness {
  requests: TranslateBatchMessage[];
  listener?: (
    message: unknown,
    sender: { id: string },
    respond: (value: PageTranslationStatus) => void,
  ) => unknown;
}

declare global {
  interface Window {
    selectionHarness: SelectionHarness;
  }
}

async function command(page: Page, message: ContentCommandMessage): Promise<PageTranslationStatus> {
  return page.evaluate(
    (contentMessage) =>
      new Promise<PageTranslationStatus>((respond) => {
        const listener = window.selectionHarness.listener;
        if (!listener) throw new Error('The built content script did not register a listener.');
        listener(contentMessage, { id: 'domlingo-selection-test' }, respond);
      }),
    message,
  );
}

async function selectText(page: Page, selector: string, selectedText: string): Promise<void> {
  await page.evaluate(
    ({ selector, selectedText }) => {
      const target = document.querySelector(selector)!.firstChild as Text;
      const start = target.data.indexOf(selectedText);
      if (start < 0) throw new Error('The requested text is not in the fixture.');
      const range = document.createRange();
      range.setStart(target, start);
      range.setEnd(target, start + selectedText.length);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    },
    { selector, selectedText },
  );
}

function smartMenu(page: Page): () => Promise<PageTranslationStatus> {
  type ClickListener = Parameters<
    TranslationContextMenuDependencies['contextMenus']['onClicked']['addListener']
  >[0];
  let listener: ClickListener | undefined;
  const actions: Promise<PageTranslationStatus>[] = [];
  const begin = (type: 'CONTENT_START_TRANSLATION' | 'CONTENT_START_SELECTION_TRANSLATION') => {
    const action = command(page, {
      version: 1,
      type,
      options: { batchCharacterLimit: 2_000, concurrency: 2 },
    });
    actions.push(action);
    return action.then(() => ({ ok: true }));
  };
  registerTranslationContextMenu({
    contextMenus: {
      create: () => TRANSLATE_MENU_ID,
      remove: async () => undefined,
      onClicked: {
        addListener: (handler: ClickListener) => {
          listener = handler;
        },
      },
    } as unknown as TranslationContextMenuDependencies['contextMenus'],
    onInstalled: {
      addListener: () => undefined,
    } as unknown as TranslationContextMenuDependencies['onInstalled'],
    startTranslation: () => begin('CONTENT_START_TRANSLATION'),
    startSelectionTranslation: () => begin('CONTENT_START_SELECTION_TRANSLATION'),
    openSettings: async () => undefined,
  });

  return async () => {
    const actionIndex = actions.length;
    const selectionText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    listener!({ menuItemId: TRANSLATE_MENU_ID, editable: false, selectionText }, {
      id: 1,
    } as chrome.tabs.Tab);
    const action = actions[actionIndex];
    if (!action) throw new Error('The smart menu did not start translation.');
    return action;
  };
}

test.beforeEach(async ({ page }) => {
  await page.setContent(`<!doctype html><html lang="en"><body>
    <main>
      <h1>A guide that does not need to be translated in full</h1>
      <p id="first">Keep prefix. First selected sentence. Second selected sentence. Keep suffix.</p>
      <p id="other">Unselected paragraph stays English. <a href="#guide">Existing link</a></p>
      <pre>fetch(endpoint, payload)</pre>
      <div id="blank" style="height: 80px"></div>
    </main>
  </body></html>`);
  await page.evaluate(() => {
    window.selectionHarness = { requests: [] };
    Object.defineProperty(window, 'chrome', {
      value: {
        runtime: {
          id: 'domlingo-selection-test',
          onMessage: {
            addListener(listener: NonNullable<SelectionHarness['listener']>) {
              window.selectionHarness.listener = listener;
            },
          },
          async sendMessage(message: TranslateBatchMessage) {
            if (message.type !== 'TRANSLATE_BATCH') return { ok: true };
            window.selectionHarness.requests.push(message);
            return {
              ok: true,
              result: {
                translations: message.payload.blocks.flatMap((block) =>
                  block.segments.map((segment) => ({ id: segment.id, text: '选中内容的中文。' })),
                ),
                failedIds: [],
                failures: [],
              },
            };
          },
        },
      },
    });
  });
  await page.addScriptTag({ path: resolve('.output/chrome-mv3/domlingo-content.js') });
});

test('the built content script translates successive selections and restores the exact page', async ({
  page,
}) => {
  const original = await page.locator('main').innerHTML();
  const start: ContentCommandMessage = {
    version: 1,
    type: 'CONTENT_START_SELECTION_TRANSLATION',
    options: { batchCharacterLimit: 2_000, concurrency: 2 },
  };

  await selectText(page, '#first', 'First selected sentence.');
  await command(page, start);
  await expect(page.locator('#first')).toHaveText(
    'Keep prefix. 选中内容的中文。 Second selected sentence. Keep suffix.',
  );
  await selectText(page, '#first', 'Second selected sentence.');
  await command(page, start);
  await expect(page.locator('#first')).toHaveText(
    'Keep prefix. 选中内容的中文。 选中内容的中文。 Keep suffix.',
  );
  await expect(page.locator('#other')).toHaveText(
    'Unselected paragraph stays English. Existing link',
  );
  const requests = await page.evaluate(() => window.selectionHarness.requests);
  expect(requests).toHaveLength(2);
  expect(requests.map((request) => request.payload.blocks[0]!.context)).toEqual([
    'First selected sentence.',
    'Second selected sentence.',
  ]);
  expect(JSON.stringify(requests)).not.toMatch(/Keep prefix|Keep suffix|Unselected|Existing link/);
  await command(page, { version: 1, type: 'CONTENT_RESTORE_ORIGINAL' });
  expect(await page.locator('main').innerHTML()).toBe(original);
});

test('the built content script reports a missing selection without sending the article', async ({
  page,
}) => {
  const original = await page.locator('main').innerHTML();
  const status = await command(page, {
    version: 1,
    type: 'CONTENT_START_SELECTION_TRANSLATION',
    options: { batchCharacterLimit: 2_000, concurrency: 2 },
  });

  expect(status.state).toBe('error');
  expect(status.message).toContain('请先');
  expect(await page.evaluate(() => window.selectionHarness.requests)).toEqual([]);
  expect(await page.locator('main').innerHTML()).toBe(original);
});

test('the registered smart menu translates the whole article after selection translation and a blank-space click', async ({
  page,
}) => {
  const original = await page.locator('main').innerHTML();
  const translate = smartMenu(page);

  await selectText(page, '#first', 'First selected sentence.');
  await translate();
  await expect(page.locator('#first')).toHaveText(
    'Keep prefix. 选中内容的中文。 Second selected sentence. Keep suffix.',
  );
  await expect(page.locator('#other')).toHaveText(
    'Unselected paragraph stays English. Existing link',
  );

  await page.locator('#blank').click();
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe('');
  await translate();

  await expect(page.locator('h1')).toHaveText('选中内容的中文。');
  await expect(page.locator('#first')).toHaveText('选中内容的中文。');
  await expect(page.locator('#other')).not.toContainText('Unselected paragraph stays English.');
  const requests = await page.evaluate(() => window.selectionHarness.requests);
  expect(requests).toHaveLength(2);
  expect(requests[0]!.payload.blocks[0]!.context).toBe('First selected sentence.');
  expect(JSON.stringify(requests[1]!.payload.blocks)).toContain(
    'Keep prefix. First selected sentence.',
  );
  expect(JSON.stringify(requests[1]!.payload.blocks)).toContain(
    'Unselected paragraph stays English.',
  );
  expect(JSON.stringify(requests[1]!.payload.blocks)).not.toContain('选中内容的中文。');
  await expect(page.locator('pre')).toHaveText('fetch(endpoint, payload)');
  await expect(page.locator('a')).toHaveAttribute('href', '#guide');

  await command(page, { version: 1, type: 'CONTENT_RESTORE_ORIGINAL' });
  expect(await page.locator('main').innerHTML()).toBe(original);
});
