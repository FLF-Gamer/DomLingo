import { describe, expect, it } from 'vitest';

import { validateProviderEndpoint } from '../../src/providers/endpoint';

describe('validateProviderEndpoint', () => {
  it('accepts a remote HTTPS chat completions endpoint', () => {
    expect(validateProviderEndpoint('https://api.example.com/v1/chat/completions')).toEqual({
      ok: true,
      endpoint: 'https://api.example.com/v1/chat/completions',
      permissionPattern: 'https://api.example.com/*',
      isLoopback: false,
    });
  });

  it('accepts loopback HTTP and keeps the endpoint port out of the permission pattern', () => {
    expect(validateProviderEndpoint('http://localhost:11434/v1/chat/completions')).toEqual({
      ok: true,
      endpoint: 'http://localhost:11434/v1/chat/completions',
      permissionPattern: 'http://localhost/*',
      isLoopback: true,
    });
  });

  it('rejects insecure remote HTTP endpoints', () => {
    expect(validateProviderEndpoint('http://api.example.com/v1/chat/completions')).toMatchObject({
      ok: false,
      code: 'INSECURE_REMOTE_ENDPOINT',
    });
  });

  it.each([
    'https://user:password@api.example.com/v1/chat/completions',
    'https://api.example.com/v1/chat/completions?api_key=secret',
    'https://api.example.com/v1/chat/completions#secret',
  ])('rejects secret-prone URL components in %s', (endpoint) => {
    expect(validateProviderEndpoint(endpoint)).toMatchObject({
      ok: false,
      code: 'URL_COMPONENT_NOT_ALLOWED',
    });
  });
});
