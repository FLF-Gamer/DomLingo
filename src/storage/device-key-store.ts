const DEVICE_KEY_DATABASE = 'domlingo-device-secrets';
const DEVICE_KEY_STORE = 'device-keys';
const DEVICE_KEY_ID = 'aes-gcm-v1';

let deviceKeyPromise: Promise<CryptoKey> | undefined;

function openDeviceKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVICE_KEY_DATABASE, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DEVICE_KEY_STORE)) {
        database.createObjectStore(DEVICE_KEY_STORE);
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to open device key store.'));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function isUsableDeviceKey(value: unknown): value is CryptoKey {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<CryptoKey>;
  const algorithm = candidate.algorithm;

  return (
    candidate.type === 'secret' &&
    candidate.extractable === false &&
    typeof algorithm === 'object' &&
    algorithm !== null &&
    algorithm.name === 'AES-GCM' &&
    Array.isArray(candidate.usages) &&
    candidate.usages.includes('encrypt') &&
    candidate.usages.includes('decrypt')
  );
}

async function readDeviceKey(database: IDBDatabase): Promise<CryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DEVICE_KEY_STORE, 'readonly');
    const request = transaction.objectStore(DEVICE_KEY_STORE).get(DEVICE_KEY_ID);

    request.onerror = () => reject(request.error ?? new Error('Unable to read device key.'));
    request.onsuccess = () =>
      resolve(isUsableDeviceKey(request.result) ? request.result : undefined);
  });
}

async function writeDeviceKey(database: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DEVICE_KEY_STORE, 'readwrite');
    transaction.objectStore(DEVICE_KEY_STORE).put(key, DEVICE_KEY_ID);

    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Unable to save device key.'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Unable to save device key.'));
    transaction.oncomplete = () => resolve();
  });
}

async function loadOrCreateDeviceKey(): Promise<CryptoKey> {
  const database = await openDeviceKeyDatabase();

  try {
    const storedKey = await readDeviceKey(database);
    if (storedKey) return storedKey;

    const generatedKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await writeDeviceKey(database, generatedKey);
    return generatedKey;
  } finally {
    database.close();
  }
}

export async function getOrCreateDeviceKey(): Promise<CryptoKey> {
  deviceKeyPromise ??= loadOrCreateDeviceKey().catch((error: unknown) => {
    deviceKeyPromise = undefined;
    throw error;
  });

  return deviceKeyPromise;
}
