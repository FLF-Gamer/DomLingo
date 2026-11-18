import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Worker,
  type Page,
} from '@playwright/test';
import { pdfDocument } from '../fixtures/pdf-document';
import { academicAbstract } from '../fixtures/pdf-selection';
import { prepareTestExtension } from '../fixtures/test-extension';

let context: BrowserContext;
let server: Server;
let profile: string;
let worker: Worker;
let requests: string[];
let pdfUrl: string;
let tabId: number;
let fixture: Page;
let longResult: boolean;

function requestPayload(request: string) {
  const input = JSON.parse(request) as { messages: { role: string; content: string }[] };
  return JSON.parse(input.messages.find((message) => message.role === 'user')!.content) as {
    blocks: { context: string; segments: { id: string; text: string }[] }[];
  };
}

async function clickPdfMenu(selectionText: string, nativeFrame = false): Promise<void> {
  const tab = await worker.evaluate((id) => chrome.tabs.get(id), tabId);
  await fixture.locator('#translate').evaluate(
    (button, selection) => {
      (button as HTMLButtonElement).dataset.selection = JSON.stringify(selection);
    },
    { tabId, tab, selectionText, nativeFrame },
  );
  await fixture.getByRole('button', { name: 'Translate selection' }).click();
}

async function panelState() {
  return worker.evaluate(
    async (id) => ({
      ...((await chrome.storage.session.get(`domlingo.pdfPanel.${id}`))[
        `domlingo.pdfPanel.${id}`
      ] as Record<string, unknown> | undefined),
      openError: (globalThis as unknown as { __pdfOpenError?: string }).__pdfOpenError ?? '',
    }),
    tabId,
  );
}

test.beforeEach(async () => {
  requests = [];
  longResult = false;
  server = createServer(async (request, response) => {
    if (request.url?.startsWith('/document')) {
      response.writeHead(200, { 'Content-Type': 'application/pdf' });
      response.end(pdfDocument());
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(404);
      response.end();
      return;
    }
    let body = '';
    for await (const chunk of request) body += String(chunk);
    requests.push(body);
    const input = JSON.parse(body) as { messages: { role: string; content: string }[] };
    const payload = JSON.parse(
      input.messages.find((message) => message.role === 'user')!.content,
    ) as { blocks: { segments: { id: string; text: string }[] }[] };
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                translations: payload.blocks.flatMap((block) =>
                  block.segments.map((segment) => ({
                    id: segment.id,
                    text: longResult
                      ? '清晨的光线穿过窗户，照亮了桌上的书页。窗外的树影随风轻轻摇动，远处偶尔传来鸟鸣。\n\n'.repeat(
                          60,
                        )
                      : segment.text.startsWith('Only')
                        ? '只翻译这一句话。'
                        : '另一个段落的译文。',
                  })),
                ),
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Model fixture did not start.');
  const origin = `http://127.0.0.1:${address.port}`;
  pdfUrl = `${origin}/document.pdf`;
  profile = await mkdtemp(join(tmpdir(), 'domlingo-native-pdf-'));
  const extension = await prepareTestExtension(profile, true);
  context = await chromium.launchPersistentContext(join(profile, 'browser'), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
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
  }, `${origin}/v1/chat/completions`);
  const pdf = await context.newPage();
  await pdf.goto(pdfUrl);
  tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)!.id!,
    pdfUrl,
  );
  const nextPage = context.waitForEvent('page');
  await worker.evaluate(() =>
    chrome.windows.create({
      url: chrome.runtime.getURL('menu-fixture.html'),
      type: 'popup',
      focused: false,
      width: 360,
      height: 200,
    }),
  );
  fixture = await nextPage;
  await fixture.waitForLoadState();
});

test.afterEach(async () => {
  await context?.close();
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (profile) await rm(profile, { recursive: true, force: true });
});

test('native PDF context-menu selection opens a real side panel without opening a reader tab', async () => {
  const before = await worker.evaluate(() => chrome.tabs.query({}));
  await clickPdfMenu('Only translate this sentence.');
  await expect
    .poll(async () => await panelState())
    .toMatchObject({
      phase: 'completed',
      text: '只翻译这一句话。',
      message: '翻译完成',
      openError: '',
    });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain('Only translate this sentence.');
  expect(requests[0]).not.toMatch(
    /Keep this private|Outside selection|Another independent|Second page/,
  );
  const after = await worker.evaluate(() => chrome.tabs.query({}));
  expect(after).toHaveLength(before.length);
  expect(after.find((tab) => tab.id === tabId)?.url).toBe(pdfUrl);
  expect(after.some((tab) => tab.url?.includes('/pdf.html'))).toBe(false);
  const panels = await worker.evaluate(() =>
    chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }),
  );
  expect(panels).toHaveLength(1);
  expect(panels[0]?.documentUrl).toMatch(/sidepanel\.html$/);
  await expect
    .poll(async () => {
      const panel = await worker.evaluate(() =>
        chrome.runtime.sendMessage({ type: '__READ_PDF_PANEL' }),
      );
      return panel?.text;
    })
    .toContain('只翻译这一句话。');
  const panel = await worker.evaluate(() =>
    chrome.runtime.sendMessage({ type: '__READ_PDF_PANEL' }),
  );
  expect(panel).toMatchObject({
    titleText: 'PDF 选区翻译',
    settingsText: '模型设置',
    footerText: null,
    hasUrlInput: false,
    overflow: false,
    fontSize: '13px',
  });
  expect(panel.textWidth).toBeGreaterThanOrEqual(panel.width - 24);
  expect(panel.textTop).toBeLessThanOrEqual(110);

  await worker.evaluate((id) => chrome.tabs.update(id, { url: 'about:blank' }), tabId);
  await expect
    .poll(async () => {
      const panel = await worker.evaluate(() =>
        chrome.runtime.sendMessage({ type: '__READ_PDF_PANEL' }),
      );
      return panel?.text;
    })
    .not.toContain('只翻译这一句话。');
  expect(requests).toHaveLength(1);
});

test('native viewer frame works with suffix-free PDFs and empty clicks never reuse the prior selection', async () => {
  const pdf = context.pages().find((page) => page.url() === pdfUrl)!;
  await pdf.goto(pdfUrl.replace('.pdf', ''));
  await clickPdfMenu('Another independent paragraph.');
  await expect
    .poll(async () => await panelState())
    .toMatchObject({
      phase: 'completed',
      text: '另一个段落的译文。',
      message: '翻译完成',
      openError: '',
    });
  await clickPdfMenu('', true);
  await expect
    .poll(async () => await panelState())
    .toMatchObject({ phase: 'idle', sourceText: '', text: '' });
  await expect
    .poll(() => worker.evaluate(() => chrome.runtime.sendMessage({ type: '__READ_PDF_PANEL' })))
    .toMatchObject({
      titleText: 'PDF 选区翻译',
      settingsText: '模型设置',
      footerText: null,
      emptyText: '在 PDF 中选中文字，再右键选择“DomLingo：AI 翻译”。',
    });
  expect(requests).toHaveLength(1);
});

test('a complete PDF abstract reaches the model as one segment with no inserted paragraph breaks', async () => {
  await clickPdfMenu(academicAbstract);
  await expect
    .poll(async () => await panelState())
    .toMatchObject({ phase: 'completed', text: '另一个段落的译文。' });
  expect(requests).toHaveLength(1);
  const payload = requestPayload(requests[0]!);
  expect(payload.blocks).toHaveLength(1);
  expect(payload.blocks[0]!.context).toBe('');
  expect(payload.blocks[0]!.segments).toEqual([
    { id: 'pdf-selection-text', text: academicAbstract },
  ]);
});

test('long PDF selections reach the model in whole-paragraph batches under 4,000 characters', async () => {
  const paragraphs = Array.from(
    { length: 7 },
    (_, index) => `Paragraph ${index + 1}. ${Array<string>(3).fill(academicAbstract).join(' ')}`,
  );
  const source = paragraphs.join('\n\n');
  expect(source.length).toBeGreaterThan(20_000);
  await clickPdfMenu(source);
  const text = paragraphs.map(() => '另一个段落的译文。').join('\n\n');
  await expect.poll(panelState).toMatchObject({ phase: 'completed', sourceText: source, text });
  expect(requests).toHaveLength(paragraphs.length);
  requests.forEach((request, index) => {
    const payload = requestPayload(request);
    expect(payload.blocks).toHaveLength(1);
    expect(payload.blocks[0]!.context).toBe('');
    expect(payload.blocks[0]!.segments).toHaveLength(1);
    expect(payload.blocks[0]!.segments[0]!.text).toBe(paragraphs[index]);
    expect(payload.blocks[0]!.segments[0]!.text.length).toBeLessThanOrEqual(4_000);
  });
  await expect
    .poll(() => worker.evaluate(() => chrome.runtime.sendMessage({ type: '__READ_PDF_PANEL' })))
    .toMatchObject({ text: expect.stringContaining(text) });
});

test('oversized PDF paragraphs split only between complete sentences without extra result paragraphs', async () => {
  const sentences = ['First', 'Second', 'Third'].map(
    (name) => `${name} ${'word '.repeat(430)}sentence ends here.`,
  );
  const source = sentences.join(' ');
  await clickPdfMenu(source);
  await expect.poll(panelState).toMatchObject({
    phase: 'completed',
    text: '另一个段落的译文。'.repeat(sentences.length),
  });
  expect(requests).toHaveLength(sentences.length);
  const sent = requests.map((request) => requestPayload(request).blocks[0]!.segments[0]!.text);
  expect(sent).toEqual(sentences);
  expect(sent.every((text) => text.length <= 4_000)).toBe(true);
  expect(sent.join(' ')).toBe(source);
});

test('a single PDF sentence over 4,000 characters shows an error without sending a partial request', async () => {
  await clickPdfMenu(`A sentence ${'word '.repeat(850)}ends here.`);
  await expect.poll(panelState).toMatchObject({
    phase: 'error',
    text: '',
    message: '单句超过 4,000 字符，请缩小选区。',
  });
  expect(requests).toHaveLength(0);
});

test('a disconnected PDF panel stops sending on tab changes and works again after reopening', async () => {
  await clickPdfMenu('Only translate this sentence.');
  await expect.poll(panelState).toMatchObject({ phase: 'completed' });
  const readPanel = () =>
    worker.evaluate(() => chrome.runtime.sendMessage({ type: '__READ_PDF_PANEL' }));
  await expect.poll(readPanel).toMatchObject({
    connectionErrors: [],
    retryDisabled: false,
    text: expect.stringContaining('只翻译这一句话。'),
  });
  const before = await readPanel();
  const disconnected = await worker.evaluate(() => {
    const ports = (globalThis as unknown as { __pdfPanelConnections: chrome.runtime.Port[] })
      .__pdfPanelConnections;
    for (const port of ports) port.disconnect();
    return ports.length;
  });
  expect(disconnected).toBe(1);
  await expect.poll(readPanel).toMatchObject({
    noticeText: '扩展连接已断开，请关闭侧栏后重新右键翻译。',
    retryDisabled: true,
    text: expect.stringContaining('只翻译这一句话。'),
  });
  const otherId = await worker.evaluate(async (id) => {
    const tab = await chrome.tabs.get(id);
    return (await chrome.tabs.create({ windowId: tab.windowId, url: 'about:blank', active: true }))
      .id!;
  }, tabId);
  await expect.poll(readPanel).toMatchObject({
    connectionPosts: before.connectionPosts,
    connectionErrors: [],
    noticeText: '扩展连接已断开，请关闭侧栏后重新右键翻译。',
  });
  await worker.evaluate(
    async ({ pdf, other }) => {
      await chrome.tabs.update(pdf, { active: true });
      await chrome.tabs.remove(other);
    },
    { pdf: tabId, other: otherId },
  );
  expect(await readPanel()).toMatchObject({
    connectionPosts: before.connectionPosts,
    connectionErrors: [],
    retryDisabled: true,
  });
  expect(requests).toHaveLength(1);

  await worker.evaluate(() => chrome.sidePanel.setOptions({ enabled: false }));
  await expect
    .poll(() => worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })))
    .toHaveLength(0);
  await worker.evaluate(() => chrome.sidePanel.setOptions({ enabled: true }));
  await clickPdfMenu('Another independent paragraph.');
  await expect.poll(panelState).toMatchObject({ phase: 'completed', text: '另一个段落的译文。' });
  await expect.poll(readPanel).toMatchObject({
    connectionErrors: [],
    noticeText: null,
    retryDisabled: false,
    text: expect.stringContaining('另一个段落的译文。'),
  });
  expect(requests).toHaveLength(2);
});

test('long PDF translations use the panel width and scroll below a compact toolbar', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  longResult = true;
  await clickPdfMenu('Another independent paragraph.');
  await expect.poll(async () => await panelState()).toMatchObject({ phase: 'completed' });
  await expect
    .poll(() => worker.evaluate(() => chrome.runtime.sendMessage({ type: '__READ_PDF_PANEL' })))
    .toMatchObject({
      fontSize: '13px',
      lineHeight: '20.8px',
      scrollableText: true,
      overflow: false,
      verticalOverflow: false,
    });
  const panel = await worker.evaluate(() =>
    chrome.runtime.sendMessage({ type: '__READ_PDF_PANEL' }),
  );
  expect(panel.textWidth).toBeGreaterThanOrEqual(panel.width - 24);
  expect(panel.textHeight).toBeGreaterThan(panel.height * 0.65);
  expect(panel.textTop).toBeLessThanOrEqual(110);
  expect(panel.toolbarBottom).toBeLessThanOrEqual(104);

  const snapshot = await worker.evaluate(() =>
    chrome.runtime.sendMessage({ type: '__CAPTURE_PDF_PANEL' }),
  );
  await fixture.setViewportSize({ width: snapshot.width, height: snapshot.height });
  await fixture.setContent(`<!doctype html>${snapshot.html}`);
  await expect(fixture.getByLabel('译文正文')).toHaveCSS('font-size', '13px');
  await fixture.screenshot({ path: testInfo.outputPath('pdf-panel-compact.png') });
});
