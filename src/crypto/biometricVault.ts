const BIOMETRIC_DB_NAME = 'kagivault_biometric_keys';
const BIOMETRIC_STORE_NAME = 'biometric_vaults';
const BIOMETRIC_DB_VERSION = 1;
const ENROLLED_INDEX_KEY = 'kv_biometric_enrolled_ids';

export interface BiometricVaultRecord {
  vaultId: string;
  credentialIdB64: string;
  rpId: string;
  key: CryptoKey;
  saltB64: string;
  iterations: number;
  enrolledAt: string;
  label: string;
}

export interface BiometricCapabilities {
  supported: boolean;
  platformAvailable: boolean;
  inIframe: boolean;
  rpId: string;
}

export interface AuthenticatorFlags {
  userPresent: boolean;
  userVerified: boolean;
  backupEligible: boolean;
  backupState: boolean;
  attestedCredentialData: boolean;
  extensionData: boolean;
  rawFlags: number;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(b64url: string): Uint8Array {
  const normalized = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padding);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * WebAuthn authenticatorData layout (RFC / WebAuthn Level 2):
 * bytes 0..31: rpIdHash (32 bytes)
 * byte 32: flags (1 byte)
 *   bit 0 (0x01): UP - User Present
 *   bit 2 (0x04): UV - User Verified (Face ID / Windows Hello / Biometric / PIN)
 *   bit 3 (0x08): BE - Backup Eligible
 *   bit 4 (0x10): BS - Backup State
 *   bit 6 (0x40): AT - Attested Credential Data
 *   bit 7 (0x80): ED - Extension Data
 * bytes 33..36: signCount (4 bytes)
 */
export function parseAuthenticatorDataFlags(
  authenticatorData: ArrayBuffer | Uint8Array
): AuthenticatorFlags {
  const view =
    authenticatorData instanceof Uint8Array
      ? authenticatorData
      : new Uint8Array(authenticatorData);
  if (view.length < 37) {
    throw new Error('生体認証の応答データ (authenticatorData) が不正です。');
  }
  const rawFlags = view[32];
  return {
    userPresent: (rawFlags & 0x01) !== 0,
    userVerified: (rawFlags & 0x04) !== 0,
    backupEligible: (rawFlags & 0x08) !== 0,
    backupState: (rawFlags & 0x10) !== 0,
    attestedCredentialData: (rawFlags & 0x40) !== 0,
    extensionData: (rawFlags & 0x80) !== 0,
    rawFlags,
  };
}

export function verifyAssertionResponseFields(params: {
  expectedCredentialIdB64: string;
  actualRawId: ArrayBuffer | Uint8Array;
  authenticatorData: ArrayBuffer | Uint8Array;
}): AuthenticatorFlags {
  const actualBytes =
    params.actualRawId instanceof Uint8Array
      ? params.actualRawId
      : new Uint8Array(params.actualRawId);
  const actualB64 = base64UrlEncode(actualBytes);
  if (actualB64 !== params.expectedCredentialIdB64) {
    throw new Error('登録済みの生体認証パスキーと一致しませんでした。');
  }
  const flags = parseAuthenticatorDataFlags(params.authenticatorData);
  if (!flags.userPresent || !flags.userVerified) {
    throw new Error(
      '顔認証・生体認証による本人確認 (User Verification) が完了しませんでした。'
    );
  }
  return flags;
}

export function translateBiometricError(err: unknown, inIframe = false): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
        return inIframe
          ? '埋め込みプレビュー内では顔認証・生体認証が制限される場合があります。新しいタブでアプリを開いてお試しください。'
          : '顔認証・生体認証がキャンセルされたか、タイムアウトしました。';
      case 'SecurityError':
        return inIframe
          ? 'iframe環境のセキュリティ制限により顔認証を実行できません。新しいタブで直接開いてご利用ください。'
          : '現在の接続環境では WebAuthn 生体認証を利用できません（HTTPS または localhost が必要です）。';
      case 'InvalidStateError':
        return 'この端末の認証情報はすでに登録されています。';
      case 'NotSupportedError':
        return 'この端末またはブラウザはプラットフォーム生体認証 (Face ID / Windows Hello) に対応していません。';
      case 'AbortError':
        return '生体認証の処理が中断されました。';
      default:
        return `生体認証エラー (${err.name}): ${err.message}`;
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return '顔認証・生体認証の処理に失敗しました。';
}

export function getEnrolledBiometricVaultIds(): string[] {
  try {
    const raw = localStorage.getItem(ENROLLED_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

function saveEnrolledBiometricVaultIds(ids: string[]): void {
  try {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) {
      localStorage.removeItem(ENROLLED_INDEX_KEY);
    } else {
      localStorage.setItem(ENROLLED_INDEX_KEY, JSON.stringify(unique));
    }
  } catch {
    // ignore storage errors
  }
}

function openBiometricDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(BIOMETRIC_DB_NAME, BIOMETRIC_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BIOMETRIC_STORE_NAME)) {
        db.createObjectStore(BIOMETRIC_STORE_NAME, { keyPath: 'vaultId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function detectBiometricCapabilities(): Promise<BiometricCapabilities> {
  if (typeof window === 'undefined') {
    return { supported: false, platformAvailable: false, inIframe: false, rpId: '' };
  }
  const inIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();
  const rpId = window.location.hostname || 'localhost';
  const supported =
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function' &&
    typeof navigator.credentials?.get === 'function';

  if (!supported) {
    return { supported: false, platformAvailable: false, inIframe, rpId };
  }

  let platformAvailable = false;
  try {
    platformAvailable = Boolean(
      await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()
    );
  } catch {
    platformAvailable = false;
  }

  return {
    supported,
    platformAvailable,
    inIframe,
    rpId,
  };
}

export async function syncEnrolledBiometricVaultIds(): Promise<string[]> {
  try {
    const db = await openBiometricDb();
    const ids = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(BIOMETRIC_STORE_NAME, 'readonly');
      const store = tx.objectStore(BIOMETRIC_STORE_NAME);
      const req = store.getAllKeys();
      req.onsuccess = () =>
        resolve((req.result as IDBValidKey[]).map((k) => String(k)));
      req.onerror = () => reject(req.error);
    });
    db.close();
    saveEnrolledBiometricVaultIds(ids);
    return ids;
  } catch {
    return getEnrolledBiometricVaultIds();
  }
}

export async function getBiometricRecord(
  vaultId: string
): Promise<BiometricVaultRecord | null> {
  try {
    const db = await openBiometricDb();
    const record = await new Promise<BiometricVaultRecord | null>((resolve, reject) => {
      const tx = db.transaction(BIOMETRIC_STORE_NAME, 'readonly');
      const store = tx.objectStore(BIOMETRIC_STORE_NAME);
      const req = store.get(vaultId);
      req.onsuccess = () => resolve((req.result as BiometricVaultRecord) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return record;
  } catch {
    return null;
  }
}

export async function updateBiometricVaultKey(params: {
  vaultId: string;
  key: CryptoKey;
  saltB64: string;
  iterations: number;
}): Promise<void> {
  const existing = await getBiometricRecord(params.vaultId);
  if (!existing) return;
  const db = await openBiometricDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BIOMETRIC_STORE_NAME, 'readwrite');
    const store = tx.objectStore(BIOMETRIC_STORE_NAME);
    store.put({
      ...existing,
      key: params.key,
      saltB64: params.saltB64,
      iterations: params.iterations,
    } satisfies BiometricVaultRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Registers a device-bound WebAuthn platform credential (Face ID / Windows Hello / Biometrics)
 * directly from user activation, then binds the non-extractable vault CryptoKey in IndexedDB.
 */
export async function enrollBiometricForVault(params: {
  vaultId: string;
  vaultName: string;
  userEmail?: string | null;
  key: CryptoKey;
  saltB64: string;
  iterations: number;
}): Promise<string[]> {
  if (
    typeof window === 'undefined' ||
    typeof window.PublicKeyCredential === 'undefined' ||
    !navigator.credentials?.create
  ) {
    throw new Error('このブラウザは WebAuthn 顔認証・生体認証に対応していません。');
  }

  const inIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  const rpId = window.location.hostname || 'localhost';
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userIdBytes = crypto.getRandomValues(new Uint8Array(16));

  let credential: Credential | null = null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'KagiVault',
          id: rpId,
        },
        user: {
          id: userIdBytes,
          name: params.userEmail || `vault:${params.vaultId}`,
          displayName: `${params.vaultName} (${params.vaultId})`,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    });
  } catch (err) {
    throw new Error(translateBiometricError(err, inIframe));
  }

  if (!credential || credential.type !== 'public-key') {
    throw new Error('顔認証・生体認証パスキーの作成が完了しませんでした。');
  }

  const pkCred = credential as PublicKeyCredential;
  const credentialIdB64 = base64UrlEncode(new Uint8Array(pkCred.rawId));
  const record: BiometricVaultRecord = {
    vaultId: params.vaultId,
    credentialIdB64,
    rpId,
    key: params.key,
    saltB64: params.saltB64,
    iterations: params.iterations,
    enrolledAt: new Date().toISOString(),
    label: `${params.vaultName} 生体認証`,
  };

  const db = await openBiometricDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BIOMETRIC_STORE_NAME, 'readwrite');
    const store = tx.objectStore(BIOMETRIC_STORE_NAME);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  return await syncEnrolledBiometricVaultIds();
}

/**
 * Prompts WebAuthn face/biometric verification (`userVerification: 'required'`)
 * and returns the stored non-extractable CryptoKey only after validating UP+UV flags.
 */
export async function verifyAndLoadBiometricVaultKey(vaultId: string): Promise<{
  key: CryptoKey;
  saltB64: string;
  iterations: number;
}> {
  const record = await getBiometricRecord(vaultId);
  if (!record) {
    saveEnrolledBiometricVaultIds(
      getEnrolledBiometricVaultIds().filter((id) => id !== vaultId)
    );
    throw new Error(
      'この端末にはボルトの顔認証情報が登録されていません。マスターパスフレーズでロック解除後に再登録してください。'
    );
  }

  if (
    typeof window === 'undefined' ||
    typeof window.PublicKeyCredential === 'undefined' ||
    !navigator.credentials?.get
  ) {
    throw new Error('このブラウザは WebAuthn 顔認証・生体認証に対応していません。');
  }

  const inIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const allowBytes = base64UrlDecode(record.credentialIdB64);
  const allowIdBuffer = allowBytes.buffer.slice(
    allowBytes.byteOffset,
    allowBytes.byteOffset + allowBytes.byteLength
  ) as ArrayBuffer;

  let assertion: Credential | null = null;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: record.rpId || window.location.hostname || 'localhost',
        allowCredentials: [
          {
            id: allowIdBuffer,
            type: 'public-key',
            transports: ['internal', 'hybrid'],
          },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    });
  } catch (err) {
    throw new Error(translateBiometricError(err, inIframe));
  }

  if (!assertion || assertion.type !== 'public-key') {
    throw new Error('顔認証の確認が取得できませんでした。');
  }

  const pkAssertion = assertion as PublicKeyCredential;
  const response = pkAssertion.response as AuthenticatorAssertionResponse;
  verifyAssertionResponseFields({
    expectedCredentialIdB64: record.credentialIdB64,
    actualRawId: pkAssertion.rawId,
    authenticatorData: response.authenticatorData,
  });

  return {
    key: record.key,
    saltB64: record.saltB64,
    iterations: record.iterations,
  };
}

export async function removeBiometricForVault(vaultId: string): Promise<string[]> {
  try {
    const db = await openBiometricDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BIOMETRIC_STORE_NAME, 'readwrite');
      const store = tx.objectStore(BIOMETRIC_STORE_NAME);
      store.delete(vaultId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
  const next = getEnrolledBiometricVaultIds().filter((id) => id !== vaultId);
  saveEnrolledBiometricVaultIds(next);
  return await syncEnrolledBiometricVaultIds();
}

export async function clearAllBiometricKeys(): Promise<void> {
  saveEnrolledBiometricVaultIds([]);
  try {
    const db = await openBiometricDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BIOMETRIC_STORE_NAME, 'readwrite');
      const store = tx.objectStore(BIOMETRIC_STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}
