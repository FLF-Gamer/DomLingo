import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { pdfDocument } from '../fixtures/pdf-document';
import { prepareTestExtension } from '../fixtures/test-extension';

let context: BrowserContext;
let page: Page;
let server: Server;
let profile: string;
let requests: string[];
let hold: boolean;
let release: (() => void) | undefined;

async function selectSentence(text: string): Promise<void> {
  const bounds = await page.locator('.textLayer').evaluate((layer, selected) => {
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const index = node.textContent!.indexOf(selected);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + selected.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    }
    throw new Error('The requested PDF text was not rendered.');
  }, text);
  expect(bounds.height).toBeGreaterThan(5);
  await page.mouse.move(bounds.x - 1, bounds.y - 1);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width + 1, bounds.y + bounds.height + 1, { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async () => {
  requests = [];
  hold = false;
  release = undefined;
  server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {
      response.end();
      return;
    }
    let body = '';
    for await (const chunk of request) body += String(chunk);
    requests.push(body);
    const input = JSON.parse(body) as { messages: { role: string; content: string }[] };
    const payload = JSON.parse(
      input.messages.find((message) => message.role === 'user')!.content,
    ) as {
      blocks: { segments: { id: string; text: string }[] }[];
    };
    const translated = payload.blocks.flatMap((block) =>
      block.segments.map((segment) => ({
        id: segment.id,
        text: segment.text.startsWith('Only') ? '只翻译这一句话。' : '另一个段落的译文。',
      })),
    );
    const send = () => {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify({ translations: translated }) },
            },
          ],
        }),
      );
    };
    if (hold && requests.length === 1) release = send;
    else send();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The model fixture did not start.');
  profile = await mkdtemp(join(tmpdir(), 'domlingo-pdf-test-'));
  const extension = await prepareTestExtension(profile);
  context = await chromium.launchPersistentContext(join(profile, 'browser'), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  await worker.evaluate(async (endpoint) => {
    await chrome.storage.sync.set({
      'domlingo.syncedSettings': {
        schemaVersion: 1,
        providerId: 'ollama',
        endpoint,
        model: 'pdf-test',
        structuredOutputMode: 'prompt',
      },
    });
  }, `http://127.0.0.1:${address.port}/v1/chat/completions`);
  page = await context.newPage();
  await page.goto(`chrome-extension://${id}/pdf.html`);
  await page
    .locator('#pdf-file')
    .setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: pdfDocument() });
  await expect(page.locator('.pdf-page')).toHaveAttribute('data-ready', 'true');
});

test.afterEach(async () => {
  release?.();
  await context?.close();
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (profile) await rm(profile, { recursive: true, force: true });
});

test('the packaged PDF reader translates only rectangle text and keeps the result clear of the original', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  await selectSentence('Only translate this sentence.');
  const card = page.getByRole('region', { name: '选区译文' });
  await expect(card).toContainText('只翻译这一句话。');
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain('Only translate this sentence.');
  expect(requests[0]).not.toMatch(
    /Keep this private|Outside selection|Another independent|Second page/,
  );
  const original = await page.getByTestId('selected-region').boundingBox();
  const result = await card.boundingBox();
  expect(original).not.toBeNull();
  expect(result).not.toBeNull();
  const overlap =
    original!.x < result!.x + result!.width &&
    original!.x + original!.width > result!.x &&
    original!.y < result!.y + result!.height &&
    original!.y + original!.height > result!.y;
  expect(overlap).toBe(false);
  await expect(page.locator('.textLayer')).toContainText(
    'Only translate this sentence. Keep this private.',
  );
  await page.screenshot({ path: testInfo.outputPath('pdf-region.png') });
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.textLayer')).toContainText('Second page original content.');
});

test('a new rectangle replaces pending translation and ignores its late response', async () => {
  hold = true;
  await selectSentence('Only translate this sentence.');
  await expect.poll(() => requests.length).toBe(1);
  await selectSentence('Another independent paragraph.');
  const card = page.getByRole('region', { name: '选区译文' });
  await expect(card).toContainText('另一个段落的译文。');
  release?.();
  await expect(card).not.toContainText('只翻译这一句话。');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('selected-region')).toHaveCount(0);
});

test('blank PDF areas do not invoke the model and a narrow reader uses a separate panel', async () => {
  await page.setViewportSize({ width: 340, height: 800 });
  await expect
    .poll(async () => (await page.locator('.pdf-page').boundingBox())?.width ?? Infinity)
    .toBeLessThan(340);
  await expect(page.locator('.pdf-page')).toHaveAttribute('data-ready', 'true');
  await selectSentence('Only translate this sentence.');
  const card = page.getByRole('region', { name: '选区译文' });
  await expect(card).toHaveClass(/translation-card--docked/);
  await expect(card).toContainText('只翻译这一句话。');
  const scroll = await page.locator('.reader-scroll').boundingBox();
  const box = await card.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(scroll!.y + scroll!.height);
  await page.getByRole('button', { name: '关闭译文' }).click();
  const paper = await page.locator('.pdf-page').boundingBox();
  await page.mouse.move(paper!.x + 10, paper!.y + 5);
  await page.mouse.down();
  await page.mouse.move(paper!.x + 40, paper!.y + 20, { steps: 3 });
  await page.mouse.up();
  await expect(card).toContainText('没有可提取的文字');
  expect(requests).toHaveLength(1);
});
