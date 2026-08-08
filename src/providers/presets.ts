import type { ProviderPresetId } from './types';

export interface ProviderPreset {
  id: ProviderPresetId;
  label: string;
  endpoint: string;
  modelExample: string;
  apiKeyRequired: boolean;
  helpUrl: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    modelExample: 'deepseek-v4-flash',
    apiKeyRequired: true,
    helpUrl: 'https://api-docs.deepseek.com/',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    modelExample: '~openai/gpt-latest',
    apiKeyRequired: true,
    helpUrl: 'https://openrouter.ai/docs/quickstart',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    modelExample: 'gpt-5-mini',
    apiKeyRequired: true,
    helpUrl: 'https://developers.openai.com/api/reference/resources/chat',
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    modelExample: 'Pro/zai-org/GLM-4.7',
    apiKeyRequired: true,
    helpUrl: 'https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    modelExample: 'gpt-oss:20b',
    apiKeyRequired: false,
    helpUrl: 'https://docs.ollama.com/api/openai-compatibility',
  },
  {
    id: 'custom',
    label: '自定义 OpenAI-compatible',
    endpoint: '',
    modelExample: '输入服务支持的模型 ID',
    apiKeyRequired: false,
    helpUrl: '',
  },
] as const;

export function getProviderPreset(id: ProviderPresetId): ProviderPreset {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) ?? PROVIDER_PRESETS[0]!;
}
