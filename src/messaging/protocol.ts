import {
  PROVIDER_PRESET_IDS,
  type PublicProviderConfig,
  type ProviderTestResponse,
} from '../providers/types';

export interface TestProviderMessage {
  version: 1;
  type: 'TEST_PROVIDER';
  config: PublicProviderConfig;
}

export type ExtensionMessage = TestProviderMessage;

export type ExtensionResponse = ProviderTestResponse;

export function isTestProviderMessage(value: unknown): value is TestProviderMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<TestProviderMessage>;

  return (
    message.version === 1 &&
    message.type === 'TEST_PROVIDER' &&
    typeof message.config === 'object' &&
    message.config !== null &&
    typeof message.config.endpoint === 'string' &&
    typeof message.config.model === 'string' &&
    typeof message.config.providerId === 'string' &&
    PROVIDER_PRESET_IDS.some((providerId) => providerId === message.config?.providerId)
  );
}
