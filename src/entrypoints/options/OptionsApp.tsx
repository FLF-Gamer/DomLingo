import { useEffect, useMemo, useState } from 'react';

import { requestEndpointPermission } from '../../background/permission-service';
import type { TestProviderMessage } from '../../messaging/protocol';
import { validateProviderEndpoint } from '../../providers/endpoint';
import { getProviderPreset, PROVIDER_PRESETS } from '../../providers/presets';
import type { ProviderPresetId, ProviderTestResponse } from '../../providers/types';
import { PRODUCT_FULL_NAME } from '../../shared/product';
import {
  DEFAULT_SYNCED_SETTINGS,
  loadSyncedSettings,
  saveSyncedSettings,
  type SyncedSettings,
} from '../../storage/settings-store';
import { setSessionApiKey } from '../../storage/session-secret-store';

type FormStatus =
  | { tone: 'idle'; message: string }
  | { tone: 'busy'; message: string }
  | { tone: 'success'; message: string }
  | { tone: 'error'; message: string };

const INITIAL_STATUS: FormStatus = {
  tone: 'idle',
  message: '保存前会申请精确 API 域名权限并测试连接。',
};

export function OptionsApp() {
  const [settings, setSettings] = useState<SyncedSettings>(DEFAULT_SYNCED_SETTINGS);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<FormStatus>(INITIAL_STATUS);
  const preset = useMemo(() => getProviderPreset(settings.providerId), [settings.providerId]);

  useEffect(() => {
    void loadSyncedSettings()
      .then(setSettings)
      .catch(() => {
        setStatus({ tone: 'error', message: '无法读取浏览器同步设置，请重新打开设置页。' });
      })
      .finally(() => setLoading(false));
  }, []);

  const updateField = <Key extends keyof SyncedSettings>(key: Key, value: SyncedSettings[Key]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setStatus(INITIAL_STATUS);
  };

  const selectProvider = (providerId: ProviderPresetId) => {
    const nextPreset = getProviderPreset(providerId);
    setSettings((current) => ({
      ...current,
      providerId,
      endpoint: nextPreset.endpoint,
      model: providerId === 'custom' ? '' : nextPreset.modelExample,
    }));
    setApiKey('');
    setStatus(INITIAL_STATUS);
  };

  const testAndSave = async () => {
    const validation = validateProviderEndpoint(settings.endpoint);
    if (!validation.ok) {
      setStatus({ tone: 'error', message: validation.message });
      return;
    }

    if (!settings.model.trim()) {
      setStatus({ tone: 'error', message: '请输入模型名称。' });
      return;
    }

    if (preset.apiKeyRequired && !apiKey.trim()) {
      setStatus({ tone: 'error', message: '该服务需要 API Key。' });
      return;
    }

    try {
      setStatus({ tone: 'busy', message: '正在申请域名权限…' });
      const permission = await requestEndpointPermission(validation.endpoint);
      if (!permission.ok) {
        setStatus({ tone: 'error', message: permission.message });
        return;
      }

      setStatus({ tone: 'busy', message: '正在测试模型连接…' });
      await setSessionApiKey(settings.providerId, apiKey);

      const message: TestProviderMessage = {
        version: 1,
        type: 'TEST_PROVIDER',
        config: {
          providerId: settings.providerId,
          endpoint: validation.endpoint,
          model: settings.model.trim(),
        },
      };

      const response = (await chrome.runtime.sendMessage(message)) as ProviderTestResponse;
      if (!response.ok) {
        await setSessionApiKey(settings.providerId, '');
        setStatus({ tone: 'error', message: response.message });
        return;
      }

      await saveSyncedSettings({
        ...settings,
        endpoint: validation.endpoint,
        model: settings.model.trim(),
      });
      setStatus({
        tone: 'success',
        message: '连接成功。普通设置已同步；API Key 当前仅保存在可信会话中。',
      });
    } catch {
      await setSessionApiKey(settings.providerId, '').catch(() => undefined);
      setStatus({
        tone: 'error',
        message: '扩展无法完成连接测试，请重新加载扩展后再试。',
      });
    }
  };

  return (
    <main className="options-shell">
      <header>
        <p className="eyebrow">{PRODUCT_FULL_NAME}</p>
        <h1>设置</h1>
        <p className="intro">配置你自己的模型服务。DomLingo 不设置请求中转服务器。</p>
      </header>

      <section className="settings-card" aria-labelledby="provider-heading">
        <div className="section-heading">
          <p className="section-index">01</p>
          <h2 id="provider-heading">翻译服务</h2>
          <p>兼容 Chat Completions 协议</p>
        </div>

        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void testAndSave();
          }}
        >
          <label>
            <span>服务预设</span>
            <select
              value={settings.providerId}
              disabled={loading}
              onChange={(event) => selectProvider(event.target.value as ProviderPresetId)}
            >
              {PROVIDER_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>API 地址</span>
            <input
              type="url"
              value={settings.endpoint}
              disabled={loading}
              placeholder="https://api.example.com/v1/chat/completions"
              spellCheck={false}
              onChange={(event) => updateField('endpoint', event.target.value)}
            />
          </label>

          <label>
            <span>API Key {preset.apiKeyRequired ? '' : '（可选）'}</span>
            <input
              type="password"
              value={apiKey}
              disabled={loading}
              autoComplete="off"
              placeholder={preset.apiKeyRequired ? '输入 API Key' : '本地服务可以留空'}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <small>当前仅保存到受信任的浏览器会话；设备级加密持久化正在 M1 中实现。</small>
          </label>

          <label>
            <span>模型名称</span>
            <input
              type="text"
              value={settings.model}
              disabled={loading}
              placeholder={preset.modelExample}
              spellCheck={false}
              onChange={(event) => updateField('model', event.target.value)}
            />
          </label>

          <div className="form-actions">
            <button type="submit" disabled={loading || status.tone === 'busy'}>
              {status.tone === 'busy' ? '处理中…' : '测试连接并保存'}
            </button>
            {preset.helpUrl ? (
              <a href={preset.helpUrl} target="_blank" rel="noreferrer">
                查看服务文档
              </a>
            ) : null}
          </div>

          <p className={`form-status form-status--${status.tone}`} role="status">
            {status.message}
          </p>
        </form>
      </section>

      <section className="notice-card" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">隐私与权限</h2>
        <p>
          只有你点击测试或保存时，DomLingo 才会申请该 API
          域名的访问权限。网页正文只会在你主动翻译后发送到所选服务。
        </p>
      </section>
    </main>
  );
}
