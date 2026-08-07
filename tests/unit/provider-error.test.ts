import { describe, expect, it } from 'vitest';

import { mapProviderHttpStatus } from '../../src/providers/provider-error';

describe('mapProviderHttpStatus', () => {
  it.each([
    [400, 'INVALID_REQUEST'],
    [401, 'AUTHENTICATION_FAILED'],
    [403, 'AUTHENTICATION_FAILED'],
    [404, 'ENDPOINT_NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'SERVER_ERROR'],
    [503, 'SERVER_ERROR'],
  ] as const)('maps HTTP %i to %s', (status, code) => {
    expect(mapProviderHttpStatus(status)).toBe(code);
  });
});
