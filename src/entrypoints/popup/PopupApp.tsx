import { useEffect, useState } from 'react';

import type {
  PageTranslationStatus,
  PopupControlMessage,
  TranslationControlResponse,
} from '../../messaging/protocol';
import { PRODUCT_FULL_NAME } from '../../shared/product';

const INITIAL_STATUS: PageTranslationStatus = {
  state: 'idle',
  total: 0,
  translated: 0,
  failed: 0,
  failureDetails: {},
  message: '正在读取当前页面状态…',
};

export function PopupApp() {
  const [tabId, setTabId] = useState<number>();
  const [status, setStatus] = useState<PageTranslationStatus>(INITIAL_STATUS);
  const [provider, setProvider] = useState('模型配置');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);

  const openSettings = () => {
    void browser.runtime.openOptionsPage();
  };

  const applyResponse = (response: TranslationControlResponse | undefined) => {
    if (!response) {
      setStatus({ ...INITIAL_STATUS, state: 'error', message: '扩展后台没有响应。' });
      return;
    }
    if (!response.ok) {
      setStatus({ ...INITIAL_STATUS, state: 'error', message: response.message });
      return;
    }

    setStatus(response.status);
    setProvider(response.providerLabel);
    setModel(response.model);
  };

  const sendControl = async (type: PopupControlMessage['type'], targetTabId = tabId) => {
    if (targetTabId === undefined) return;
    const message = { version: 1, type, tabId: targetTabId } as PopupControlMessage;
    applyResponse((await browser.runtime.sendMessage(message)) as TranslationControlResponse);
  };

  useEffect(() => {
    let active = true;
    let currentTabId: number | undefined;

    const refresh = async () => {
      if (!active || currentTabId === undefined) return;
      try {
        const message: PopupControlMessage = {
          version: 1,
          type: 'GET_TAB_STATUS',
          tabId: currentTabId,
        };
        const response = (await browser.runtime.sendMessage(message)) as TranslationControlResponse;
        if (active) applyResponse(response);
      } catch {
        if (active) {
          setStatus({ ...INITIAL_STATUS, state: 'error', message: '无法读取当前页面状态。' });
        }
      }
    };

    void browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (!active) return;
      currentTabId = tabs[0]?.id;
      setTabId(currentTabId);
      if (currentTabId === undefined) {
        setStatus({ ...INITIAL_STATUS, state: 'error', message: '没有找到当前标签页。' });
        return;
      }
      void refresh();
    });

    const interval = window.setInterval(() => void refresh(), 750);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const runAction = async (type: PopupControlMessage['type']) => {
    try {
      setBusy(true);
      await sendControl(type);
    } catch {
      setStatus({ ...INITIAL_STATUS, state: 'error', message: '操作失败，请重新打开扩展。' });
    } finally {
      setBusy(false);
    }
  };

  const isTranslating = status.state === 'scanning' || status.state === 'translating';
  const hasTranslations = status.translated > 0;
  const processed = status.translated + status.failed;

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <span className="brand-mark" aria-hidden="true">
          D
        </span>
        <div>
          <h1>{PRODUCT_FULL_NAME}</h1>
          <p>
            {provider}
            {model ? ` / ${model}` : ''}
          </p>
        </div>
      </header>

      <section className={`status-card status-card--${status.state}`} aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <strong>
            {isTranslating
              ? `翻译中 ${processed} / ${status.total}`
              : status.state === 'completed'
                ? '翻译完成'
                : status.state === 'error'
                  ? '需要处理'
                  : '准备就绪'}
          </strong>
          <p>{status.message}</p>
        </div>
      </section>

      <div className="actions" aria-label="翻译操作">
        {isTranslating ? (
          <button
            type="button"
            className="primary-button primary-button--stop"
            disabled={busy}
            onClick={() => void runAction('STOP_TRANSLATION')}
          >
            停止翻译
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            disabled={busy || tabId === undefined}
            onClick={() => void runAction('START_TRANSLATION')}
          >
            翻译当前页面
          </button>
        )}
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !hasTranslations}
          onClick={() => void runAction('RESTORE_ORIGINAL')}
        >
          恢复原文
        </button>
      </div>

      <button type="button" className="settings-button" onClick={openSettings}>
        打开设置
      </button>
    </main>
  );
}
