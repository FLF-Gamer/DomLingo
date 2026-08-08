export type EndpointErrorCode =
  | 'EMPTY_ENDPOINT'
  | 'INSECURE_REMOTE_ENDPOINT'
  | 'INVALID_ENDPOINT'
  | 'URL_COMPONENT_NOT_ALLOWED'
  | 'UNSUPPORTED_PROTOCOL';

export type EndpointValidationResult =
  | {
      ok: true;
      endpoint: string;
      permissionPattern: string;
      isLoopback: boolean;
    }
  | { ok: false; code: EndpointErrorCode; message: string };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

export function validateProviderEndpoint(value: string): EndpointValidationResult {
  const candidate = value.trim();

  if (candidate.length === 0) {
    return {
      ok: false,
      code: 'EMPTY_ENDPOINT',
      message: '请输入模型服务的 API 地址。',
    };
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return {
      ok: false,
      code: 'INVALID_ENDPOINT',
      message: 'API 地址格式无效，请输入完整 URL。',
    };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      code: 'UNSUPPORTED_PROTOCOL',
      message: 'API 地址只支持 HTTPS；本机 Ollama 可以使用 HTTP。',
    };
  }

  if (url.username || url.password || url.search || url.hash) {
    return {
      ok: false,
      code: 'URL_COMPONENT_NOT_ALLOWED',
      message: 'API 地址不能包含账号、密码、查询参数或片段。',
    };
  }

  const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol === 'http:' && !isLoopback) {
    return {
      ok: false,
      code: 'INSECURE_REMOTE_ENDPOINT',
      message: '远程模型服务必须使用 HTTPS；HTTP 仅允许 localhost 或 127.0.0.1。',
    };
  }

  const hostPattern = `${url.protocol}//${url.hostname}/*`;

  return {
    ok: true,
    endpoint: url.toString(),
    permissionPattern: hostPattern,
    isLoopback,
  };
}
