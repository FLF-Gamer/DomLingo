import { useEffect, useMemo, useState } from 'react';

import {
  listGrantedEndpointPermissions,
  requestEndpointPermission,
  revokeEndpointPermission,
  type GrantedEndpointPermission,
} from '../../background/permission-service';
import type { TestProviderMessage } from '../../messaging/protocol';
import { validateProviderEndpoint } from '../../providers/endpoint';
import { getProviderPreset, PROVIDER_PRESETS } from '../../providers/presets';
import type { ProviderPresetId, ProviderTestResponse } from '../../providers/types';
import { PRODUCT_FULL_NAME } from '../../shared/product';
import {
  clearApiKey,
  getApiKey,
  hasSavedApiKey as checkHasSavedApiKey,
  saveApiKey,
} from '../../storage/api-key-store';
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
  const [hasSavedApiKey, setHasSavedApiKey] = useState(false);
  const [grantedPermissions, setGrantedPermissions] = useState<GrantedEndpointPermission[]>([]);
  const [revokingPermission, setRevokingPermission] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<FormStatus>(INITIAL_STATUS);
  const preset = useMemo(() => getProviderPreset(settings.providerId), [settings.providerId]);

  useEffect(() => {
    void Promise.all([loadSyncedSettings(), listGrantedEndpointPermissions()])
      .then(([savedSettings, permissions]) => {
        setSettings(savedSettings);
        setGrantedPermissions(permissions);
      })
      .catch(() => {
        setStatus({ tone: 'error', message: '无法读取扩展设置或权限，请重新打开设置页。' });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let active = true;
    void checkHasSavedApiKey(settings.providerId)
      .then((saved) => {
        if (active) setHasSavedApiKey(saved);
      })
      .catch(() => {
        if (active) setHasSavedApiKey(false);
      });

    return () => {
      active = false;
    };
  }, [settings.providerId]);

  const refreshGrantedPermissions = async () => {
    setGrantedPermissions(await listGrantedEndpointPermissions());
  };

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
      structuredOutputMode: 'prompt',
    }));
    setApiKey('');
    setHasSavedApiKey(false);
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

    const enteredApiKey = apiKey.trim();
    if (preset.apiKeyRequired && !enteredApiKey && !hasSavedApiKey) {
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
      await refreshGrantedPermissions();

      setStatus({ tone: 'busy', message: '正在测试模型连接…' });
      if (enteredApiKey) {
        await setSessionApiKey(settings.providerId, enteredApiKey);
      } else {
        await getApiKey(settings.providerId);
      }

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
        if (enteredApiKey) await setSessionApiKey(settings.providerId, '');
        setStatus({ tone: 'error', message: response.message });
        return;
      }

      if (enteredApiKey) await saveApiKey(settings.providerId, enteredApiKey);
      await saveSyncedSettings({
        ...settings,
        endpoint: validation.endpoint,
        model: settings.model.trim(),
        structuredOutputMode: response.structuredOutputMode,
      });
      setApiKey('');
      setHasSavedApiKey(hasSavedApiKey || Boolean(enteredApiKey));
      setStatus({
        tone: 'success',
        message: `连接成功，结构化输出模式：${
          response.structuredOutputMode === 'json-schema'
            ? 'JSON Schema'
            : response.structuredOutputMode === 'json-object'
              ? 'JSON Mode'
              : 'Prompt 兼容模式'
        }。${enteredApiKey ? 'API Key 已在本机加密保存。' : '普通设置已同步。'}`,
      });
    } catch {
      if (enteredApiKey) {
        await setSessionApiKey(settings.providerId, '').catch(() => undefined);
      }
      setStatus({
        tone: 'error',
        message: '扩展无法完成连接测试，请重新加载扩展后再试。',
      });
    }
  };

  const removeSavedApiKey = async () => {
    try {
      await clearApiKey(settings.providerId);
      setApiKey('');
      setHasSavedApiKey(false);
      setStatus({ tone: 'success', message: '已删除该服务在本机保存的 API Key。' });
    } catch {
      setStatus({ tone: 'error', message: '无法删除已保存的 API Key，请重新加载扩展后再试。' });
    }
  };

  const removePermission = async (permission: GrantedEndpointPermission) => {
    try {
      setRevokingPermission(permission.pattern);
      const removed = await revokeEndpointPermission(permission.pattern);
      if (!removed) {
        setStatus({ tone: 'error', message: `无法撤销 ${permission.origin} 的访问权限。` });
        return;
      }

      await refreshGrantedPermissions();
      setStatus({ tone: 'success', message: `已撤销 ${permission.origin} 的访问权限。` });
    } catch {
      setStatus({ tone: 'error', message: `无法撤销 ${permission.origin} 的访问权限。` });
    } finally {
      setRevokingPermission(undefined);
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

          <div className="credential-field">
            <label>
              <span>API Key {preset.apiKeyRequired ? '' : '（可选）'}</span>
              <input
                type="password"
                value={apiKey}
                disabled={loading}
                autoComplete="off"
                placeholder={
                  hasSavedApiKey
                    ? '已保存；输入新 Key 可替换'
                    : preset.apiKeyRequired
                      ? '输入 API Key'
                      : '本地服务可以留空'
                }
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            <div className="credential-help">
              <small>
                {hasSavedApiKey
                  ? '已使用本设备不可导出的密钥加密保存；留空会继续使用已保存的 Key。'
                  : '保存后使用本设备不可导出的密钥加密，明文只在受信任会话中使用。'}
              </small>
              {hasSavedApiKey ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void removeSavedApiKey()}
                >
                  删除已保存 Key
                </button>
              ) : null}
            </div>
          </div>

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
            <small>
              当前结构化输出：
              {settings.structuredOutputMode === 'json-schema'
                ? 'JSON Schema'
                : settings.structuredOutputMode === 'json-object'
                  ? 'JSON Mode'
                  : 'Prompt 兼容模式'}
              ；保存时会重新探测。
            </small>
          </label>

          <label>
            <span>并发请求数</span>
            <input
              type="number"
              min={1}
              max={3}
              step={1}
              value={settings.concurrency}
              disabled={loading}
              onChange={(event) =>
                updateField(
                  'concurrency',
                  Math.max(1, Math.min(3, Math.floor(Number(event.target.value) || 1))),
                )
              }
            />
            <small>默认 3；诊断服务并发兼容性时可以设为 1。</small>
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
        <div className="permission-list" aria-label="已授权的 API 域名">
          <h3>已授权域名</h3>
          {grantedPermissions.length > 0 ? (
            <ul>
              {grantedPermissions.map((permission) => (
                <li key={permission.pattern}>
                  <code>{permission.origin}</code>
                  <button
                    type="button"
                    disabled={revokingPermission === permission.pattern}
                    onClick={() => void removePermission(permission)}
                  >
                    {revokingPermission === permission.pattern ? '撤销中…' : '撤销'}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>尚未授权任何模型 API 域名。</p>
          )}
        </div>
      </section>
    </main>
  );
}
