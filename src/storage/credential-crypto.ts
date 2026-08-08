export interface DeviceEncryptedCredentialEnvelope {
  schemaVersion: 1;
  algorithm: 'AES-GCM';
  iv: string;
  ciphertext: string;
}

const ADDITIONAL_DATA = new TextEncoder().encode('DomLingo:device-api-key:v1');

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function isDeviceEncryptedCredentialEnvelope(
  value: unknown,
): value is DeviceEncryptedCredentialEnvelope {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<DeviceEncryptedCredentialEnvelope>;
  return (
    candidate.schemaVersion === 1 &&
    candidate.algorithm === 'AES-GCM' &&
    typeof candidate.iv === 'string' &&
    candidate.iv.length > 0 &&
    typeof candidate.ciphertext === 'string' &&
    candidate.ciphertext.length > 0
  );
}

export async function encryptCredential(
  plaintext: string,
  key: CryptoKey,
): Promise<DeviceEncryptedCredentialEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: ADDITIONAL_DATA },
    key,
    encoded,
  );

  return {
    schemaVersion: 1,
    algorithm: 'AES-GCM',
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptCredential(
  envelope: DeviceEncryptedCredentialEnvelope,
  key: CryptoKey,
): Promise<string> {
  if (!isDeviceEncryptedCredentialEnvelope(envelope)) {
    throw new Error('Invalid encrypted credential envelope.');
  }

  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(envelope.iv),
      additionalData: ADDITIONAL_DATA,
    },
    key,
    base64ToBytes(envelope.ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}
