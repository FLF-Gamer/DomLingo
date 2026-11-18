import { cp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function prepareTestExtension(
  directory: string,
  captureMenus = false,
): Promise<string> {
  const extension = join(directory, 'extension');
  await cp(resolve('.output/chrome-mv3'), extension, { recursive: true });
  const manifestPath = join(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(manifestPath, JSON.stringify(manifest));
  if (captureMenus) {
    const backgroundPath = join(extension, manifest.background.service_worker);
    const script = await readFile(backgroundPath, 'utf8');
    const harness = `
      globalThis.__pdfMenuListeners = [];
      globalThis.__pdfPanelConnections = [];
      chrome.runtime.onConnect.addListener((port) => {
        if (port.name === 'domlingo-pdf-panel' && port.sender?.url?.endsWith('/sidepanel.html'))
          globalThis.__pdfPanelConnections.push(port);
      });
      const openPanel = chrome.sidePanel.open.bind(chrome.sidePanel);
      chrome.sidePanel.open = async (options) => {
        try { return await openPanel(options); }
        catch (error) { globalThis.__pdfOpenError = String(error); throw error; }
      };
      const registerMenu = chrome.contextMenus.onClicked.addListener.bind(chrome.contextMenus.onClicked);
      chrome.contextMenus.onClicked.addListener = (listener) => {
        globalThis.__pdfMenuListeners.push(listener);
        registerMenu(listener);
      };
      chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (message.type !== '__PDF_MENU_FIXTURE' || sender.id !== chrome.runtime.id) return false;
        const tab = message.tab;
          for (const listener of globalThis.__pdfMenuListeners) listener({
            menuItemId: 'domlingo-translate-current-page', editable: false,
            pageUrl: tab.url, frameId: 4, selectionText: message.selectionText,
            ...(message.nativeFrame ? { frameUrl: 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html' } : {}),
          }, tab);
          respond({ ok: true });
        return true;
      });
    `;
    await writeFile(backgroundPath, harness + script);
    await writeFile(
      join(extension, 'menu-fixture.html'),
      '<!doctype html><html><body><button id="translate">Translate selection</button><script src="menu-fixture.js"></script></body></html>',
    );
    await writeFile(
      join(extension, 'menu-fixture.js'),
      `document.getElementById('translate').addEventListener('click', (event) => {
      chrome.runtime.sendMessage({type: '__PDF_MENU_FIXTURE', ...JSON.parse(event.currentTarget.dataset.selection)});
    });`,
    );
    const panelPath = join(extension, 'sidepanel.html');
    const panelHtml = await readFile(panelPath, 'utf8');
    await writeFile(
      panelPath,
      panelHtml.replace('<head>', '<head><script src="panel-fixture.js"></script>'),
    );
    await writeFile(
      join(extension, 'panel-fixture.js'),
      `const connectionErrors = [];
      let connectionPosts = 0;
      const connectPanel = chrome.runtime.connect.bind(chrome.runtime);
      chrome.runtime.connect = (...args) => {
        const port = connectPanel(...args);
        const post = port.postMessage.bind(port);
        port.postMessage = (message) => {
          connectionPosts++;
          try { return post(message); }
          catch (error) { connectionErrors.push(String(error)); throw error; }
        };
        return port;
      };
      window.addEventListener('error', (event) => connectionErrors.push(event.message));
      window.addEventListener('unhandledrejection', (event) => connectionErrors.push(String(event.reason)));
      chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      if (message.type === '__CAPTURE_PDF_PANEL') {
        const documentCopy = document.documentElement.cloneNode(true);
        documentCopy.querySelectorAll('script').forEach((script) => script.remove());
        respond({ html: documentCopy.outerHTML, width: innerWidth, height: innerHeight });
        return false;
      }
      if (message.type !== '__READ_PDF_PANEL') return false;
      const text = document.querySelector('.translated-text');
      const textRect = text?.getBoundingClientRect();
      respond({
        text: document.body.innerText,
        connectionErrors,
        connectionPosts,
        noticeText: document.querySelector('.panel-notice')?.innerText.trim() ?? null,
        retryDisabled: document.querySelector('.panel-actions button')?.disabled,
        titleText: document.querySelector('.panel-header h1')?.innerText.trim(),
        settingsText: document.querySelector('.panel-header button')?.innerText.trim(),
        footerText: document.querySelector('footer')?.innerText.trim() ?? null,
        emptyText: document.querySelector('.empty-state')?.innerText.trim(),
        hasUrlInput: !!document.querySelector('input[type="url"]'),
        overflow: document.documentElement.scrollWidth > innerWidth,
        verticalOverflow: document.documentElement.scrollHeight > innerHeight + 1,
        width: innerWidth,
        height: innerHeight,
        textWidth: textRect?.width,
        textHeight: textRect?.height,
        textTop: textRect?.top,
        fontSize: text ? getComputedStyle(text).fontSize : null,
        lineHeight: text ? getComputedStyle(text).lineHeight : null,
        scrollableText: text ? text.scrollHeight > text.clientHeight : false,
        toolbarBottom: document.querySelector('.translation-toolbar')?.getBoundingClientRect().bottom,
      });
      return false;
    });`,
    );
  }
  return extension;
}
