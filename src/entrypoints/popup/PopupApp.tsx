import { PRODUCT_FULL_NAME } from '../../shared/product';

export function PopupApp() {
  const openSettings = () => {
    void browser.runtime.openOptionsPage();
  };

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <span className="brand-mark" aria-hidden="true">
          D
        </span>
        <div>
          <h1>{PRODUCT_FULL_NAME}</h1>
          <p>开源网页正文翻译</p>
        </div>
      </header>

      <section className="status-card" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <strong>模型配置已开放</strong>
          <p>请先在设置页测试并保存你的模型服务。</p>
        </div>
      </section>

      <div className="actions" aria-label="翻译操作">
        <button type="button" className="primary-button" disabled>
          翻译当前页面
        </button>
        <button type="button" className="secondary-button" disabled>
          恢复原文
        </button>
      </div>

      <button type="button" className="settings-button" onClick={openSettings}>
        打开设置
      </button>
    </main>
  );
}
