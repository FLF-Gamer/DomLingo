import { describe, expect, it } from 'vitest';

import { getProviderPreset, PROVIDER_PRESETS } from '../../src/providers/presets';
import { validateProviderEndpoint } from '../../src/providers/endpoint';

describe('provider presets', () => {
  it('has unique IDs and valid non-custom endpoints', () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const preset of PROVIDER_PRESETS) {
      if (preset.id === 'custom') continue;
      expect(validateProviderEndpoint(preset.endpoint)).toMatchObject({ ok: true });
    }
  });

  it('returns the selected preset', () => {
    expect(getProviderPreset('ollama')).toMatchObject({
      label: 'Ollama',
      apiKeyRequired: false,
    });
  });
});
