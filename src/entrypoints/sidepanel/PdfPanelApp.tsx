import { useEffect, useRef, useState } from 'react';
import {
  PDF_PANEL_PORT,
  PDF_SELECTION_HINT,
  type PdfPanelCommand,
  type PdfPanelState,
  type PdfPanelUpdate,
} from '../../pdf/panel-protocol';

const DISCONNECTED_NOTICE = '扩展连接已断开，请关闭侧栏后重新右键翻译。';

function releaseConnectionResource(release: () => void): void {
  try {
    release();
  } catch {
    // Chrome can invalidate extension APIs before the panel has finished closing.
  }
}

export function PdfPanelApp() {
  const [state, setState] = useState<PdfPanelState | null>(null);
  const [notice, setNotice] = useState('');
  const [connected, setConnected] = useState(false);
  const sendRef = useRef<((message: PdfPanelCommand) => boolean) | null>(null);

  useEffect(() => {
    let disposed = false;
    let closed = false;
    let tabId: number | undefined;
    let windowId: number | undefined;
    let port: chrome.runtime.Port | undefined;
    let heartbeat: number | undefined;

    const post = (message: PdfPanelCommand): boolean => {
      if (disposed || closed || !port) return false;
      try {
        port.postMessage(message);
        return true;
      } catch {
        failConnection();
        return false;
      }
    };
    const watch = (id: number) => {
      if (disposed || closed) return;
      tabId = id;
      setState(null);
      if (post({ type: 'WATCH', tabId: id })) setNotice('');
    };
    const onUpdate = (update: PdfPanelUpdate) => {
      if (update.tabId !== tabId || disposed || closed) return;
      setState((previous) =>
        previous && update.state && previous.revision > update.state.revision
          ? previous
          : update.state,
      );
      setConnected(true);
      setNotice('');
    };
    const onActivated = (info: { tabId: number; windowId: number }) => {
      if (info.windowId === windowId) watch(info.tabId);
    };
    const onDisconnect = () => {
      releaseConnectionResource(() => {
        void chrome.runtime.lastError;
      });
      failConnection();
    };

    const closeConnection = () => {
      if (closed) return;
      closed = true;
      if (sendRef.current === post) sendRef.current = null;
      window.clearInterval(heartbeat);
      releaseConnectionResource(() => chrome.tabs.onActivated.removeListener(onActivated));
      releaseConnectionResource(() => port?.onMessage.removeListener(onUpdate));
      releaseConnectionResource(() => port?.onDisconnect.removeListener(onDisconnect));
      releaseConnectionResource(() => port?.disconnect());
    };
    const failConnection = () => {
      if (disposed || closed) return;
      closeConnection();
      setConnected(false);
      setNotice(DISCONNECTED_NOTICE);
    };

    try {
      port = chrome.runtime.connect({ name: PDF_PANEL_PORT });
      sendRef.current = post;
      port.onMessage.addListener(onUpdate);
      port.onDisconnect.addListener(onDisconnect);
      chrome.tabs.onActivated.addListener(onActivated);
      heartbeat = window.setInterval(() => {
        if (tabId !== undefined) post({ type: 'WATCH', tabId });
      }, 20_000);
      void chrome.windows
        .getCurrent()
        .then(async (window) => {
          if (disposed || closed) return;
          windowId = window.id;
          const tabs = await chrome.tabs.query({ active: true, windowId });
          if (!disposed && !closed && tabId === undefined && tabs[0]?.id !== undefined)
            watch(tabs[0].id);
        })
        .catch(failConnection);
    } catch {
      failConnection();
    }
    return () => {
      disposed = true;
      closeConnection();
    };
  }, []);

  const send = (type: 'STOP' | 'RETRY') => {
    if (state) sendRef.current?.({ type, selectionId: state.selectionId });
  };
  const openSettings = async () => {
    try {
      await chrome.runtime.openOptionsPage();
    } catch {
      setNotice(DISCONNECTED_NOTICE);
    }
  };
  const copy = async () => {
    if (!state?.text) return;
    try {
      await navigator.clipboard.writeText(state.text);
      setNotice('已复制译文');
    } catch {
      setNotice('复制失败，请选中译文后手动复制。');
    }
  };

  return (
    <main className="pdf-panel">
      <header className="panel-header">
        <img src="/icons/icon-32.png" width="20" height="20" alt="" />
        <h1>PDF 选区翻译</h1>
        <button type="button" onClick={() => void openSettings()}>
          模型设置
        </button>
      </header>
      {!state?.sourceText ? (
        <section className="empty-state">
          <p>{state?.message ?? PDF_SELECTION_HINT}</p>
        </section>
      ) : (
        <>
          <details className="source-text">
            <summary>原文 · {state.sourceText.length} 字符</summary>
            <p>{state.sourceText}</p>
          </details>
          <section className="translation" aria-label="选区译文" aria-live="polite">
            <div className="translation-toolbar">
              <h2>译文</h2>
              <div className="panel-actions">
                {state.phase === 'translating' ? (
                  <button type="button" disabled={!connected} onClick={() => send('STOP')}>
                    停止翻译
                  </button>
                ) : (
                  <button type="button" disabled={!connected} onClick={() => send('RETRY')}>
                    重新翻译
                  </button>
                )}
                <button type="button" disabled={!state.text} onClick={() => void copy()}>
                  复制译文
                </button>
              </div>
            </div>
            {state.phase !== 'completed' ? (
              <p className={`phase phase--${state.phase}`}>{state.message}</p>
            ) : null}
            {state.text ? (
              <p className="translated-text" tabIndex={0} aria-label="译文正文">
                {state.text}
              </p>
            ) : null}
          </section>
        </>
      )}
      {notice ? (
        <p role="status" className="panel-notice">
          {notice}
        </p>
      ) : null}
    </main>
  );
}
