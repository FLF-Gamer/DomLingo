import {
  isCancelSessionMessage,
  isPopupControlMessage,
  isTestProviderMessage,
  isTranslateBatchMessage,
  type ContentCommandMessage,
  type PageTranslationStatus,
  type PopupControlMessage,
  type TranslateBatchMessage,
  type TranslateBatchResponse,
  type TranslationControlResponse,
} from '../messaging/protocol';
import { SessionRequestRegistry } from '../background/session-request-registry';
import { registerTabLifecycleCancellation } from '../background/tab-lifecycle';
import { registerTranslationContextMenu } from '../background/translation-context-menu';
import { detectPdfInContextMenu, detectPdfSource, openPdfReader } from '../background/pdf-reader';
import { routePdfContextMenu, PdfPanelSessions } from '../background/pdf-panel';
import { isPdfPanelCommand, PDF_PANEL_PORT, PDF_SELECTION_HINT } from '../pdf/panel-protocol';
import { validateProviderEndpoint } from '../providers/endpoint';
import {
  detectOpenAICompatibleStructuredOutput,
  translateOpenAICompatible,
} from '../providers/openai-compatible';
import { getProviderPreset } from '../providers/presets';
import { ProviderRequestError } from '../providers/provider-error';
import type { ProviderTestResponse } from '../providers/types';
import { getApiKey } from '../storage/api-key-store';
import { loadSyncedSettings } from '../storage/settings-store';
import { translateWithAdaptiveSplit } from '../translation/adaptive';
import { retryProviderRequest } from '../translation/retry';

const TRUSTED_CONTEXTS = { accessLevel: 'TRUSTED_CONTEXTS' } as const;
const CONTENT_SCRIPT_FILE = 'domlingo-content.js';
const requestRegistry = new SessionRequestRegistry();
const pdfPanelPorts = new Map<chrome.runtime.Port, number>();
const pdfPanels = new PdfPanelSessions({
  storage: chrome.storage.session,
  send: async (tabId, message) => {
    if (message.type === 'CANCEL_SESSION') {
      requestRegistry.cancelSession(message.sessionId, tabId);
      return { ok: true };
    }
    return handleTranslateBatch(message, tabId);
  },
  publish: (tabId, state) => {
    for (const [port, watchedTabId] of pdfPanelPorts) {
      if (watchedTabId !== tabId) continue;
      try {
        port.postMessage({ tabId, state });
      } catch {
        pdfPanelPorts.delete(port);
      }
    }
  },
});

const IDLE_PAGE_STATUS: PageTranslationStatus = {
  state: 'idle',
  total: 0,
  translated: 0,
  failed: 0,
  failureDetails: {},
  message: '点击“翻译当前页面”开始。',
};

async function restrictStorageAccess(): Promise<void> {
  await Promise.all([
    chrome.storage.local.setAccessLevel(TRUSTED_CONTEXTS),
    chrome.storage.sync.setAccessLevel(TRUSTED_CONTEXTS),
    chrome.storage.session.setAccessLevel(TRUSTED_CONTEXTS),
  ]);
}

async function handleProviderTest(message: unknown): Promise<ProviderTestResponse> {
  if (!isTestProviderMessage(message)) {
    return { ok: false, code: 'INVALID_REQUEST', message: '无法识别测试连接请求。' };
  }

  const endpoint = validateProviderEndpoint(message.config.endpoint);
  if (!endpoint.ok || !message.config.model.trim()) {
    return { ok: false, code: 'INVALID_REQUEST', message: 'Endpoint 或模型名称无效。' };
  }

  try {
    const apiKey = await getApiKey(message.config.providerId);
    const structuredOutputMode = await detectOpenAICompatibleStructuredOutput({
      ...message.config,
      endpoint: endpoint.endpoint,
      model: message.config.model.trim(),
      apiKey,
    });
    return { ok: true, structuredOutputMode };
  } catch (error: unknown) {
    if (error instanceof ProviderRequestError) {
      return { ok: false, code: error.code, message: error.message };
    }
    return { ok: false, code: 'NETWORK_ERROR', message: '无法连接模型服务。' };
  }
}

async function sendContentMessage(
  tabId: number,
  message: ContentCommandMessage,
): Promise<PageTranslationStatus> {
  return (await chrome.tabs.sendMessage(tabId, message, { frameId: 0 })) as PageTranslationStatus;
}

async function getContentStatus(tabId: number): Promise<PageTranslationStatus | undefined> {
  try {
    return await sendContentMessage(tabId, { version: 1, type: 'CONTENT_GET_STATUS' });
  } catch {
    return undefined;
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  const currentStatus = await getContentStatus(tabId);
  if (currentStatus) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE],
  });
}

async function handlePopupControl(
  message: PopupControlMessage,
): Promise<TranslationControlResponse> {
  const settings = await loadSyncedSettings();
  const preset = getProviderPreset(settings.providerId);
  const success = (
    status: PageTranslationStatus,
  ): Extract<TranslationControlResponse, { ok: true }> => ({
    ok: true,
    status,
    providerLabel: preset.label,
    model: settings.model,
  });

  if (message.type === 'OPEN_PDF_READER') {
    try {
      await openPdfReader(message.tabId);
      return success({
        ...IDLE_PAGE_STATUS,
        message: '已打开 PDF 阅读页，请打开文件并框选需要翻译的文字。',
      });
    } catch {
      return {
        ok: false,
        code: 'PAGE_UNAVAILABLE',
        message: '无法打开 PDF 阅读页，请重新加载扩展后再试。',
      };
    }
  }

  if (
    message.type === 'START_TRANSLATION' ||
    message.type === 'START_SELECTION_TRANSLATION' ||
    message.type === 'GET_TAB_STATUS'
  ) {
    try {
      const pdfState = await pdfPanels.get(message.tabId);
      if (pdfState || (await detectPdfSource(message.tabId))) {
        return {
          ...success({
            ...IDLE_PAGE_STATUS,
            message: pdfState?.phase === 'error' ? pdfState.message : PDF_SELECTION_HINT,
          }),
          pageKind: 'pdf',
        };
      }
    } catch {
      return {
        ok: false,
        code: 'PAGE_UNAVAILABLE',
        message: '无法读取当前标签页，请重新打开插件。',
      };
    }
  }

  if (message.type === 'GET_TAB_STATUS') {
    return success((await getContentStatus(message.tabId)) ?? IDLE_PAGE_STATUS);
  }

  if (
    message.type === 'START_TRANSLATION' ||
    message.type === 'START_SELECTION_TRANSLATION' ||
    message.type === 'RETRY_FAILED_TRANSLATION'
  ) {
    const endpoint = validateProviderEndpoint(settings.endpoint);
    if (!endpoint.ok || !settings.model.trim()) {
      return { ok: false, code: 'CONFIG_REQUIRED', message: '请先完成模型服务配置。' };
    }

    const hasPermission = await chrome.permissions.contains({
      origins: [endpoint.permissionPattern],
    });
    if (!hasPermission) {
      return {
        ok: false,
        code: 'CONFIG_REQUIRED',
        message: '模型 API 域名权限已失效，请在设置页重新测试连接。',
      };
    }

    if (preset.apiKeyRequired && !(await getApiKey(settings.providerId))) {
      return { ok: false, code: 'CONFIG_REQUIRED', message: '请先在设置页保存 API Key。' };
    }

    try {
      await ensureContentScript(message.tabId);
      const contentTypes = {
        START_TRANSLATION: 'CONTENT_START_TRANSLATION',
        START_SELECTION_TRANSLATION: 'CONTENT_START_SELECTION_TRANSLATION',
        RETRY_FAILED_TRANSLATION: 'CONTENT_RETRY_FAILED',
      } as const;
      const contentMessage: ContentCommandMessage = {
        version: 1,
        type: contentTypes[message.type],
        options: {
          batchCharacterLimit: settings.batchCharacterLimit,
          concurrency: settings.concurrency,
        },
      };
      return success(await sendContentMessage(message.tabId, contentMessage));
    } catch {
      return {
        ok: false,
        code: 'PAGE_UNAVAILABLE',
        message: '当前页面不允许扩展运行，请换一个普通网页。',
      };
    }
  }

  const status = await getContentStatus(message.tabId);
  if (!status) return success(IDLE_PAGE_STATUS);

  const command: ContentCommandMessage =
    message.type === 'STOP_TRANSLATION'
      ? { version: 1, type: 'CONTENT_STOP_TRANSLATION' }
      : { version: 1, type: 'CONTENT_RESTORE_ORIGINAL' };
  return success(await sendContentMessage(message.tabId, command));
}

async function handleTranslateBatch(
  message: TranslateBatchMessage,
  tabId: number,
): Promise<TranslateBatchResponse> {
  const controller = new AbortController();
  if (!requestRegistry.register(message.payload.sessionId, tabId, controller)) {
    return { ok: false, code: 'INVALID_REQUEST', message: '翻译会话来源无效。' };
  }

  try {
    const settings = await loadSyncedSettings();
    const endpoint = validateProviderEndpoint(settings.endpoint);
    if (!endpoint.ok || !settings.model.trim()) {
      return { ok: false, code: 'INVALID_REQUEST', message: '模型配置无效，请打开设置检查。' };
    }

    const apiKey = await getApiKey(settings.providerId);
    const preset = getProviderPreset(settings.providerId);
    if (preset.apiKeyRequired && !apiKey)
      return { ok: false, code: 'INVALID_REQUEST', message: '请先在模型设置中保存 API Key。' };
    if (!(await chrome.permissions.contains({ origins: [endpoint.permissionPattern] })))
      return {
        ok: false,
        code: 'INVALID_REQUEST',
        message: '模型 API 域名尚未授权，请在模型设置中测试连接并保存。',
      };
    const config = {
      providerId: settings.providerId,
      endpoint: endpoint.endpoint,
      model: settings.model.trim(),
      apiKey,
      structuredOutputMode: settings.structuredOutputMode,
    } as const;
    const result = await translateWithAdaptiveSplit(message.payload.blocks, (blocks, attempt) =>
      retryProviderRequest(
        () =>
          translateOpenAICompatible(
            config,
            blocks,
            settings.targetLanguage,
            settings.customPrompt,
            {
              signal: controller.signal,
              repairInvalidResponse: attempt.repairInvalidResponse,
            },
          ),
        { signal: controller.signal },
      ),
    );
    return { ok: true, result };
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      return { ok: false, code: 'SESSION_CANCELLED', message: '翻译已停止。' };
    }
    if (error instanceof ProviderRequestError) {
      return { ok: false, code: error.code, message: error.message };
    }
    return { ok: false, code: 'NETWORK_ERROR', message: '无法连接模型服务。' };
  } finally {
    requestRegistry.unregister(message.payload.sessionId, controller);
  }
}

export default defineBackground(() => {
  void restrictStorageAccess().catch((error: unknown) => {
    console.error('[DomLingo] Unable to restrict extension storage access.', error);
  });

  registerTabLifecycleCancellation(chrome.tabs, (tabId) => {
    requestRegistry.cancelTab(tabId);
    pdfPanels.clear(tabId);
  });

  chrome.runtime.onConnect.addListener((port) => {
    const isPanel =
      port.name === PDF_PANEL_PORT &&
      port.sender?.id === chrome.runtime.id &&
      port.sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('sidepanel.html');
    if (!isPanel) return;
    const unwatch = () => {
      const tabId = pdfPanelPorts.get(port);
      pdfPanelPorts.delete(port);
      if (tabId !== undefined && ![...pdfPanelPorts.values()].includes(tabId))
        pdfPanels.stop(tabId);
    };
    port.onDisconnect.addListener(unwatch);
    port.onMessage.addListener((message: unknown) => {
      if (!isPdfPanelCommand(message)) return;
      if (message.type === 'WATCH') {
        if (pdfPanelPorts.get(port) !== message.tabId) unwatch();
        const tabId = message.tabId;
        pdfPanelPorts.set(port, tabId);
        void pdfPanels
          .get(tabId)
          .then((state) => {
            if (pdfPanelPorts.get(port) === tabId) port.postMessage({ tabId, state });
          })
          .catch(() => undefined);
        return;
      }
      const tabId = pdfPanelPorts.get(port);
      if (tabId === undefined) return;
      if (message.type === 'STOP') pdfPanels.stop(tabId, message.selectionId);
      if (message.type === 'RETRY') pdfPanels.retry(tabId, message.selectionId);
    });
  });

  registerTranslationContextMenu({
    contextMenus: chrome.contextMenus,
    onInstalled: chrome.runtime.onInstalled,
    startTranslation: (tabId) =>
      handlePopupControl({ version: 1, type: 'START_TRANSLATION', tabId }),
    startSelectionTranslation: (tabId) =>
      handlePopupControl({ version: 1, type: 'START_SELECTION_TRANSLATION', tabId }),
    openSettings: () => chrome.runtime.openOptionsPage(),
    handlePdfContextMenu: (info, tab) =>
      routePdfContextMenu(info, tab, {
        detect: detectPdfInContextMenu,
        open: (options) => chrome.sidePanel.open(options),
        sessions: pdfPanels,
      }),
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const isOptionsPage =
      sender.id === chrome.runtime.id &&
      sender.url?.startsWith(chrome.runtime.getURL('options.html'));
    const isPopupPage =
      sender.id === chrome.runtime.id &&
      sender.url?.startsWith(chrome.runtime.getURL('popup.html'));
    const contentTabId = sender.id === chrome.runtime.id ? sender.tab?.id : undefined;

    if (isOptionsPage && isTestProviderMessage(message)) {
      void handleProviderTest(message).then(sendResponse);
      return true;
    }

    if (isPopupPage && isPopupControlMessage(message)) {
      void handlePopupControl(message).then(sendResponse);
      return true;
    }

    if (contentTabId !== undefined && isTranslateBatchMessage(message)) {
      void handleTranslateBatch(message, contentTabId).then(sendResponse);
      return true;
    }

    if (contentTabId !== undefined && isCancelSessionMessage(message)) {
      requestRegistry.cancelSession(message.sessionId, contentTabId);
      sendResponse({ ok: true });
    }

    return false;
  });
});
