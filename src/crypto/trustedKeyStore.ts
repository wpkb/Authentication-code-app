const DB_NAME = 'kagivault_trusted_keys';
const STORE_NAME = 'keys';
const DB_VERSION = 1;

export interface TrustedVaultKeyRecord {
  id: string; // `${uid}:${vaultId}`
  uid: string;
  vaultId: string;
  key: CryptoKey;
  saltB64: string;
  iterations: number;
  savedAt: string;
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function makeKeyId(uid: string, vaultId: string): string {
  return `${uid}:${vaultId}`;
}

export async function saveTrustedVaultKey(
  record: Omit<TrustedVaultKeyRecord, 'id' | 'savedAt'>
): Promise<void> {
  try {
    const db = await openKeyDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const item: TrustedVaultKeyRecord = {
        ...record,
        id: makeKeyId(record.uid, record.vaultId),
        savedAt: new Date().toISOString(),
      };
      store.put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Gracefully degrade if IndexedDB is blocked in private mode
  }
}

export async function getTrustedVaultKey(
  uid: string,
  vaultId: string
): Promise<TrustedVaultKeyRecord | null> {
  try {
    const db = await openKeyDb();
    const result = await new Promise<TrustedVaultKeyRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(makeKeyId(uid, vaultId));
      req.onsuccess = () => resolve((req.result as TrustedVaultKeyRecord) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function clearTrustedVaultKey(uid: string, vaultId: string): Promise<void> {
  try {
    const db = await openKeyDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(makeKeyId(uid, vaultId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function clearAllTrustedKeysForUser(uid: string): Promise<void> {
  try {
    const db = await openKeyDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const val = cursor.value as TrustedVaultKeyRecord;
          if (val.uid === uid) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function clearAllTrustedKeys(): Promise<void> {
  try {
    const db = await openKeyDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

