import { mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.output/chrome-mv3');
const images = resolve(root, 'docs/images');
const origin = 'https://domlingo-docs.test';
const translations = {
  'A practical guide to reading documentation': '轻松阅读技术文档',
  'Read technical documents in your own language without leaving the page.':
    '不用离开当前网页，就能用熟悉的语言阅读技术文档。',
  'Select one paragraph when you only need part of a long article.':
    '阅读长文章时，如果只需要其中一部分，可以只选中那一段来翻译。',
  'The rest of the article stays in place, including links and code examples.':
    '文章仍然留在原来的位置，链接和代码示例也会保留下来。',
  'Try the example': '试试下面的示例',
  'Open the example': '打开示例',
};

function samplePage(selection) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>DomLingo 使用示例</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f7fb; color: #172033; font-family: system-ui, -apple-system, sans-serif; }
    .demo-heading { padding: 28px 44px 22px; border-bottom: 1px solid #dfe4ee; background: white; }
    .demo-heading small { color: #4f46e5; font-size: 13px; font-weight: 700; }
    .demo-heading h1 { margin: 6px 0 0; font-size: 26px; }
    .layout { display: grid; grid-template-columns: 660px 280px; gap: 28px; margin: 28px 44px; }
    main { padding: 28px 32px; border: 1px solid #dfe4ee; border-radius: 14px; background: white; }
    nav { color: #667085; font-size: 13px; }
    article h1 { margin: 22px 0 18px; font-size: 30px; line-height: 1.3; letter-spacing: -.02em; }
    article h2 { margin: 26px 0 12px; font-size: 21px; }
    article p { margin: 18px 0; font-size: 17px; line-height: 1.8; }
    a { color: #4f46e5; }
    pre { margin: 0; padding: 18px; border-radius: 10px; background: #f0f2f7; color: #344054; font: 13px/1.7 ui-monospace, monospace; }
    .guide { align-self: start; padding: 22px; border: 1px solid #c7d2fe; border-radius: 14px; background: #eef2ff; }
    .guide h2 { margin: 0 0 16px; font-size: 18px; }
    .guide ol { margin: 0; padding-left: 20px; font-size: 15px; line-height: 1.9; }
    .guide li + li { margin-top: 10px; }
    .guide p { margin: 18px 0 0; padding-top: 16px; border-top: 1px solid #c7d2fe; font-size: 14px; line-height: 1.8; }
    .demo-caption { margin-top: 18px; color: #667085; font-size: 12px; line-height: 1.7; }
  </style>
</head>
<body>
  <aside class="demo-heading" lang="zh-CN">
    <small>DomLingo · 本地示例网页</small>
    <h1>${selection ? '选区翻译：只翻译你想看的部分' : '整页翻译：在原网页阅读中文正文'}</h1>
  </aside>
  <div class="layout">
    <main>
      <nav>Documentation &nbsp; / &nbsp; Guides &nbsp; / &nbsp; API</nav>
      <article>
        <h1>A practical guide to reading documentation</h1>
        <p>Read technical documents in your own language without leaving the page.</p>
        <p id="selected">Select one paragraph when you only need part of a long article.</p>
        <p>The rest of the article stays in place, including links and code examples.</p>
        <h2>Try the example</h2>
        <pre><code>const response = await fetch(endpoint, {
  method: 'POST',
  body: JSON.stringify(payload),
});</code></pre>
        <p><a href="#example">Open the example</a></p>
      </article>
    </main>
    <aside lang="zh-CN">
      <div class="guide">
        <h2>怎么操作</h2>
        <ol>
          <li>${selection ? '用鼠标选中第二段英文' : '不选中文字，点击页面空白处'}</li>
          <li>右键选择<br><strong>DomLingo：AI 翻译</strong></li>
          <li>${selection ? '只替换选中的文字' : '正文逐段原位显示译文'}</li>
        </ol>
        <p>${selection ? '标题和其他段落仍是英文。可以继续选择下一段，也能恢复原文。' : '导航不翻译，代码保持原样，链接仍然可以点击。'}</p>
      </div>
      <p class="demo-caption">示例译文为固定测试数据。<br>右下角为扩展实际运行的进度面板。</p>
    </aside>
  </div>
</body>
</html>`;
}

await mkdir(images, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1056, height: 880 },
    deviceScaleFactor: 1,
  });
  // All requests are fulfilled from local fixtures/build files; no service or personal profile is used.
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/sample.html') {
      return route.fulfill({
        contentType: 'text/html',
        body: samplePage(url.searchParams.has('selection')),
      });
    }
    const path = resolve(output, `.${url.pathname}`);
    if (!path.startsWith(`${output}/`)) return route.abort();
    const contentType = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
    }[extname(path)];
    try {
      return await route.fulfill({ contentType, body: await readFile(path) });
    } catch {
      return route.abort();
    }
  });
  await context.addInitScript((dictionary) => {
    const storage = { get: async () => ({}), set: async () => undefined };
    Object.defineProperty(window, 'chrome', {
      value: {
        storage: { sync: storage, local: storage, session: storage },
        permissions: { getAll: async () => ({ origins: [] }) },
        runtime: {
          id: 'domlingo-documentation',
          onMessage: {
            addListener: (listener) => {
              window.domlingoDemoListener = listener;
            },
          },
          sendMessage: async (message) => {
            if (message.type !== 'TRANSLATE_BATCH') return { ok: true };
            return {
              ok: true,
              result: {
                translations: message.payload.blocks.flatMap((block) =>
                  block.segments.map((segment) => {
                    const text = dictionary[segment.text.trim()];
                    if (!text) throw new Error(`Missing demo translation: ${segment.text}`);
                    return { id: segment.id, text };
                  }),
                ),
                failedIds: [],
                failures: [],
              },
            };
          },
        },
      },
    });
  }, translations);

  const settingsPage = await context.newPage();
  await settingsPage.setViewportSize({ width: 1056, height: 1200 });
  await settingsPage.goto(`${origin}/options.html`);
  await settingsPage.getByRole('button', { name: '测试连接并保存' }).waitFor({ state: 'visible' });
  await settingsPage.waitForFunction(() => !document.querySelector('select').disabled);
  const card = await settingsPage.locator('.settings-card').boundingBox();
  await settingsPage.screenshot({
    path: resolve(images, 'model-settings.png'),
    clip: { x: 68, y: 32, width: 920, height: Math.ceil(card.y + card.height - 8) },
  });
  await settingsPage.close();

  for (const selection of [false, true]) {
    const page = await context.newPage();
    await page.goto(`${origin}/sample.html${selection ? '?selection' : ''}`);
    await page.addScriptTag({ path: resolve(output, 'domlingo-content.js') });
    if (selection) {
      await page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector('#selected'));
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
      });
    }
    await page.evaluate(
      (isSelection) =>
        new Promise((respond) => {
          window.domlingoDemoListener(
            {
              version: 1,
              type: isSelection
                ? 'CONTENT_START_SELECTION_TRANSLATION'
                : 'CONTENT_START_TRANSLATION',
              options: { batchCharacterLimit: 2000, concurrency: 2 },
            },
            { id: 'domlingo-documentation' },
            respond,
          );
        }),
      selection,
    );
    await page.waitForFunction(() =>
      document.querySelector('#selected').textContent.includes('长文章'),
    );
    if (!selection) {
      await page.waitForFunction(
        () => document.querySelector('article h1').textContent === '轻松阅读技术文档',
      );
    }
    // The real overlay's closed shadow root contains a 180ms progress transition.
    // Screenshot animation controls cannot reach it, so allow that transition to settle.
    await page.waitForTimeout(220);
    await page.screenshot({
      path: resolve(images, selection ? 'selection-translation.png' : 'page-translation.png'),
      animations: 'disabled',
    });
    await page.close();
  }
  await context.close();
  console.log(
    'Saved README screenshots to docs/images/ (local fixtures and fixed translations only).',
  );
} finally {
  await browser.close();
}
