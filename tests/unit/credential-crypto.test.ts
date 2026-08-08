import { describe, expect, it } from 'vitest';

import {
  decryptCredential,
  encryptCredential,
  isDeviceEncryptedCredentialEnvelope,
} from '../../src/storage/credential-crypto';

async function createDeviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

describe('device credential encryption', () => {
  it('round-trips an API key without placing plaintext in the envelope', async () => {
    const deviceKey = await createDeviceKey();
    const envelope = await encryptCredential('test-secret-value', deviceKey);

    expect(envelope).toMatchObject({ schemaVersion: 1, algorithm: 'AES-GCM' });
    expect(JSON.stringify(envelope)).not.toContain('test-secret-value');
    await expect(decryptCredential(envelope, deviceKey)).resolves.toBe('test-secret-value');
  });

  it('cannot decrypt the envelope with another device key', async () => {
    const envelope = await encryptCredential('test-secret-value', await createDeviceKey());

    await expect(decryptCredential(envelope, await createDeviceKey())).rejects.toBeDefined();
  });

  it('rejects malformed stored envelopes', () => {
    expect(
      isDeviceEncryptedCredentialEnvelope({
        schemaVersion: 1,
        algorithm: 'AES-GCM',
        iv: '',
        ciphertext: 'ciphertext',
      }),
    ).toBe(false);
  });
});
