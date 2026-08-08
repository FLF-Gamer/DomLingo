import type { ProviderErrorCode } from './types';

const ERROR_MESSAGES: Record<ProviderErrorCode, string> = {
  AUTHENTICATION_FAILED: 'API Key 无效或没有访问权限，请检查模型服务配置。',
  ENDPOINT_NOT_FOUND: '没有找到 API 地址或模型，请检查 Endpoint 和模型名称。',
  INVALID_REQUEST: '模型服务拒绝了请求，请检查 Endpoint、模型名称和请求兼容性。',
  INVALID_RESPONSE: '模型服务返回了无法识别的响应。',
  NETWORK_ERROR: '无法连接模型服务，请检查网络、Endpoint 和本地服务状态。',
  RATE_LIMITED: '模型服务请求过于频繁，请稍后重试。',
  REQUEST_TIMEOUT: '连接模型服务超时，请检查网络或服务状态。',
  SERVER_ERROR: '模型服务暂时不可用，请稍后重试。',
};

export class ProviderRequestError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly retryAfterMs?: number,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'ProviderRequestError';
  }
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return undefined;
  return Math.max(0, retryAt - now);
}

export function mapProviderHttpStatus(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return 'AUTHENTICATION_FAILED';
  if (status === 404) return 'ENDPOINT_NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'INVALID_REQUEST';
}
