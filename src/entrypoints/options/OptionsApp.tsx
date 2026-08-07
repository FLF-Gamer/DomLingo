import { PRODUCT_FULL_NAME } from '../../shared/product';

const plannedProviders = ['DeepSeek', 'OpenRouter', 'OpenAI', '硅基流动', 'Ollama'];

export function OptionsApp() {
  return (
    <main className="options-shell">
      <header>
        <p className="eyebrow">{PRODUCT_FULL_NAME}</p>
        <h1>设置</h1>
        <p className="intro">M0 已完成设置页入口。模型配置将在 M1 中实现。</p>
      </header>

      <section className="settings-card" aria-labelledby="provider-heading">
        <div>
          <p className="section-index">01</p>
          <h2 id="provider-heading">翻译服务</h2>
        </div>
        <dl>
          <div>
            <dt>协议</dt>
            <dd>OpenAI-compatible</dd>
          </div>
          <div>
            <dt>目标语言</dt>
            <dd>简体中文</dd>
          </div>
          <div>
            <dt>计划预设</dt>
            <dd>{plannedProviders.join('、')}</dd>
          </div>
        </dl>
      </section>

      <section className="notice-card" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">隐私边界</h2>
        <p>
          只有用户主动点击翻译后，当前网页正文才会发送到用户选择的模型服务。DomLingo
          不设置中转服务器。
        </p>
      </section>
    </main>
  );
}
