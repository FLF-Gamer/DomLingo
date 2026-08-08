export const PROVIDER_PRESET_IDS = [
  'deepseek',
  'openrouter',
  'openai',
  'siliconflow',
  'ollama',
  'custom',
] as const;

export type ProviderPresetId = (typeof PROVIDER_PRESET_IDS)[number];

export const STRUCTURED_OUTPUT_MODES = ['json-schema', 'json-object', 'prompt'] as const;
export type StructuredOutputMode = (typeof STRUCTURED_OUTPUT_MODES)[number];

export function isStructuredOutputMode(value: unknown): value is StructuredOutputMode {
  return STRUCTURED_OUTPUT_MODES.some((mode) => mode === value);
}

export interface PublicProviderConfig {
  providerId: ProviderPresetId;
  endpoint: string;
  model: string;
}

export interface ProviderConfig extends PublicProviderConfig {
  apiKey?: string;
  structuredOutputMode?: StructuredOutputMode;
}

export type ProviderErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'ENDPOINT_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'OUTPUT_TRUNCATED'
  | 'RATE_LIMITED'
  | 'REQUEST_TIMEOUT'
  | 'SERVER_ERROR';

export type ProviderTestResponse =
  | { ok: true; structuredOutputMode: StructuredOutputMode }
  | { ok: false; code: ProviderErrorCode; message: string };
