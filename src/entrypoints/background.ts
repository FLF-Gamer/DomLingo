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
import { validateProviderEndpoint } from '../providers/endpoint';
import {
  testOpenAICompatibleConnection,
  translateOpenAICompatible,
} from '../providers/openai-compatible';
import { getProviderPreset } from '../providers/presets';
import { ProviderRequestError } from '../providers/provider-error';
import type { ProviderTestResponse } from '../providers/types';
import { getApiKey } from '../storage/api-key-store';
import { loadSyncedSettings } from '../storage/settings-store';
import { retryProviderRequest } from '../translation/retry';

const TRUSTED_CONTEXTS = { accessLevel: 'TRUSTED_CONTEXTS' } as const;
const CONTENT_SCRIPT_FILE = 'domlingo-content.js';
const activeRequests = new Map<string, Set<AbortController>>();
const sessionTabs = new Map<string, number>();

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
    await testOpenAICompatibleConnection({
      ...message.config,
      endpoint: endpoint.endpoint,
      model: message.config.model.trim(),
      apiKey,
    });
    return { ok: true };
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
  return (await chrome.tabs.sendMessage(tabId, message)) as PageTranslationStatus;
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
  const success = (status: PageTranslationStatus): TranslationControlResponse => ({
    ok: true,
    status,
    providerLabel: preset.label,
    model: settings.model,
  });

  if (message.type === 'GET_TAB_STATUS') {
    return success((await getContentStatus(message.tabId)) ?? IDLE_PAGE_STATUS);
  }

  if (message.type === 'START_TRANSLATION' || message.type === 'RETRY_FAILED_TRANSLATION') {
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
      const contentMessage: ContentCommandMessage = {
        version: 1,
        type:
          message.type === 'START_TRANSLATION'
            ? 'CONTENT_START_TRANSLATION'
            : 'CONTENT_RETRY_FAILED',
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

function registerRequest(sessionId: string, tabId: number, controller: AbortController): boolean {
  const existingTabId = sessionTabs.get(sessionId);
  if (existingTabId !== undefined && existingTabId !== tabId) return false;

  sessionTabs.set(sessionId, tabId);
  const controllers = activeRequests.get(sessionId) ?? new Set<AbortController>();
  controllers.add(controller);
  activeRequests.set(sessionId, controllers);
  return true;
}

function unregisterRequest(sessionId: string, controller: AbortController): void {
  const controllers = activeRequests.get(sessionId);
  controllers?.delete(controller);
  if (controllers?.size === 0) {
    activeRequests.delete(sessionId);
    sessionTabs.delete(sessionId);
  }
}

async function handleTranslateBatch(
  message: TranslateBatchMessage,
  tabId: number,
): Promise<TranslateBatchResponse> {
  const controller = new AbortController();
  if (!registerRequest(message.payload.sessionId, tabId, controller)) {
    return { ok: false, code: 'INVALID_REQUEST', message: '翻译会话来源无效。' };
  }

  try {
    const settings = await loadSyncedSettings();
    const endpoint = validateProviderEndpoint(settings.endpoint);
    if (!endpoint.ok || !settings.model.trim()) {
      return { ok: false, code: 'INVALID_REQUEST', message: '模型配置无效，请打开设置检查。' };
    }

    const apiKey = await getApiKey(settings.providerId);
    const result = await retryProviderRequest(
      () =>
        translateOpenAICompatible(
          {
            providerId: settings.providerId,
            endpoint: endpoint.endpoint,
            model: settings.model.trim(),
            apiKey,
          },
          message.payload.blocks,
          settings.targetLanguage,
          settings.customPrompt,
          { signal: controller.signal },
        ),
      { signal: controller.signal },
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
    unregisterRequest(message.payload.sessionId, controller);
  }
}

function cancelSession(sessionId: string, tabId: number): void {
  if (sessionTabs.get(sessionId) !== tabId) return;
  for (const controller of activeRequests.get(sessionId) ?? []) controller.abort();
  activeRequests.delete(sessionId);
  sessionTabs.delete(sessionId);
}

export default defineBackground(() => {
  void restrictStorageAccess().catch((error: unknown) => {
    console.error('[DomLingo] Unable to restrict extension storage access.', error);
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
      cancelSession(message.sessionId, contentTabId);
      sendResponse({ ok: true });
    }

    return false;
  });
});
