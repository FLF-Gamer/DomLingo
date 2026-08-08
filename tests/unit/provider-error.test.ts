import { describe, expect, it } from 'vitest';

import { mapProviderHttpStatus, parseRetryAfterMs } from '../../src/providers/provider-error';

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

describe('parseRetryAfterMs', () => {
  it('supports delta seconds and HTTP dates', () => {
    expect(parseRetryAfterMs('1.5')).toBe(1_500);
    expect(
      parseRetryAfterMs('Wed, 21 Oct 2015 07:28:10 GMT', Date.UTC(2015, 9, 21, 7, 28, 0)),
    ).toBe(10_000);
    expect(parseRetryAfterMs('invalid')).toBeUndefined();
  });
});
