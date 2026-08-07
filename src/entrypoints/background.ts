import { isTestProviderMessage } from '../messaging/protocol';
import { validateProviderEndpoint } from '../providers/endpoint';
import { testOpenAICompatibleConnection } from '../providers/openai-compatible';
import { ProviderRequestError } from '../providers/provider-error';
import type { ProviderTestResponse } from '../providers/types';
import { getSessionApiKey } from '../storage/session-secret-store';

const TRUSTED_CONTEXTS = { accessLevel: 'TRUSTED_CONTEXTS' } as const;

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

  const apiKey = await getSessionApiKey(message.config.providerId);

  try {
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

export default defineBackground(() => {
  void restrictStorageAccess().catch((error: unknown) => {
    console.error('[DomLingo] Unable to restrict extension storage access.', error);
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const isTrustedExtensionPage =
      sender.id === chrome.runtime.id &&
      sender.url?.startsWith(chrome.runtime.getURL('options.html'));

    if (!isTrustedExtensionPage || !isTestProviderMessage(message)) return false;

    void handleProviderTest(message).then(sendResponse);
    return true;
  });
});
