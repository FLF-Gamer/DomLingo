export const PROVIDER_PRESET_IDS = [
  'deepseek',
  'openrouter',
  'openai',
  'siliconflow',
  'ollama',
  'custom',
] as const;

export type ProviderPresetId = (typeof PROVIDER_PRESET_IDS)[number];

export interface PublicProviderConfig {
  providerId: ProviderPresetId;
  endpoint: string;
  model: string;
}

export interface ProviderConfig extends PublicProviderConfig {
  apiKey?: string;
}

export type ProviderErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'ENDPOINT_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'RATE_LIMITED'
  | 'REQUEST_TIMEOUT'
  | 'SERVER_ERROR';

export type ProviderTestResponse =
  { ok: true } | { ok: false; code: ProviderErrorCode; message: string };
