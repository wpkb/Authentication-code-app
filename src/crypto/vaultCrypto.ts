import type { EncryptedEnvelope, VaultPayload } from '../types/vault';

export const DEFAULT_PBKDF2_ITERATIONS = 600_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function computeChecksum(saltB64: string, ivB64: string, ciphertextB64: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${saltB64}.${ivB64}.${ciphertextB64}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

export async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passBytes = encoder.encode(passphrase);

  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    passBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const saltCopy = new Uint8Array(salt.length);
  saltCopy.set(salt);

  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltCopy,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function deriveKeyAndSalt(
  passphrase: string,
  saltB64?: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS
): Promise<{ key: CryptoKey; saltB64: string; iterations: number }> {
  let salt: Uint8Array<ArrayBuffer>;
  if (saltB64) {
    salt = base64ToBytes(saltB64);
  } else {
    salt = new Uint8Array(new ArrayBuffer(16));
    globalThis.crypto.getRandomValues(salt);
  }
  const key = await deriveAesKey(passphrase, salt, iterations);
  return {
    key,
    saltB64: saltB64 || bytesToBase64(salt),
    iterations,
  };
}

export async function encryptVaultWithKey(
  payload: VaultPayload,
  key: CryptoKey,
  saltB64: string,
  iterations: number,
  revision = 1
): Promise<EncryptedEnvelope> {
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);

  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(payload));
  const aad = encoder.encode(`KagiVault-v1:${payload.vaultId}`);

  const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aad,
      tagLength: 128,
    },
    key,
    plaintext
  );

  const ivB64 = bytesToBase64(iv);
  const ciphertextB64 = bytesToBase64(new Uint8Array(encryptedBuffer));
  const checksum = await computeChecksum(saltB64, ivB64, ciphertextB64);

  return {
    version: 1,
    vaultId: payload.vaultId,
    kdf: 'PBKDF2-SHA256',
    iterations,
    cipher: 'AES-256-GCM',
    salt: saltB64,
    iv: ivB64,
    ciphertext: ciphertextB64,
    checksum,
    updatedAt: payload.updatedAt,
    revision,
  };
}

export async function decryptVaultWithKey(
  envelope: EncryptedEnvelope,
  key: CryptoKey
): Promise<VaultPayload> {
  if (envelope.version !== 1 || envelope.cipher !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-SHA256') {
    throw new Error('サポートされていない暗号化フォーマットです。');
  }

  const expectedChecksum = await computeChecksum(envelope.salt, envelope.iv, envelope.ciphertext);
  if (expectedChecksum !== envelope.checksum) {
    throw new Error('暗号化データの整合性チェック(SHA-256)に失敗しました。データが改ざんまたは破損している可能性があります。');
  }

  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const encoder = new TextEncoder();
  const aad = encoder.encode(`KagiVault-v1:${envelope.vaultId}`);

  const ivCopy = new Uint8Array(iv.length);
  ivCopy.set(iv);
  const cipherCopy = new Uint8Array(ciphertext.length);
  cipherCopy.set(ciphertext);

  try {
    const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivCopy,
        additionalData: aad,
        tagLength: 128,
      },
      key,
      cipherCopy
    );

    const decoder = new TextDecoder();
    const json = decoder.decode(decryptedBuffer);
    const parsed = JSON.parse(json) as VaultPayload;
    if (!parsed || !Array.isArray(parsed.accounts)) {
      throw new Error('復号されたボルトの構造が不正です。');
    }
    return parsed;
  } catch {
    throw new Error('マスターパスフレーズが正しくないか、認証タグの検証に失敗しました。');
  }
}

export async function encryptVault(
  payload: VaultPayload,
  passphrase: string,
  revision = 1,
  iterations = DEFAULT_PBKDF2_ITERATIONS
): Promise<EncryptedEnvelope> {
  if (!passphrase || passphrase.length < 4) {
    throw new Error('マスターパスフレーズは4文字以上で設定してください。');
  }

  const { key, saltB64 } = await deriveKeyAndSalt(passphrase, undefined, iterations);
  return encryptVaultWithKey(payload, key, saltB64, iterations, revision);
}

export async function decryptVault(
  envelope: EncryptedEnvelope,
  passphrase: string
): Promise<VaultPayload> {
  if (!passphrase) {
    throw new Error('マスターパスフレーズを入力してください。');
  }
  const salt = base64ToBytes(envelope.salt);
  const key = await deriveAesKey(passphrase, salt, envelope.iterations);
  return decryptVaultWithKey(envelope, key);
}

export interface PassphraseEvaluation {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  entropyBits: number;
  suggestions: string[];
}

export function evaluatePassphraseStrength(passphrase: string): PassphraseEvaluation {
  if (!passphrase) {
    return {
      score: 0,
      label: '未入力',
      entropyBits: 0,
      suggestions: ['12文字以上のパスフレーズを設定してください'],
    };
  }

  let pool = 0;
  const hasLower = /[a-z]/.test(passphrase);
  const hasUpper = /[A-Z]/.test(passphrase);
  const hasDigit = /[0-9]/.test(passphrase);
  const hasSymbol = /[^a-zA-Z0-9]/.test(passphrase);

  if (hasLower) pool += 26;
  if (hasUpper) pool += 26;
  if (hasDigit) pool += 10;
  if (hasSymbol) pool += 32;
  if (pool === 0) pool = 26;

  const uniqueChars = new Set(passphrase).size;
  const effectiveLength = Math.min(passphrase.length, uniqueChars * 1.6);
  const entropyBits = Math.round(effectiveLength * Math.log2(pool));

  const suggestions: string[] = [];
  if (passphrase.length < 12) suggestions.push('12文字以上にすると総当たり耐性が大きく向上します');
  if (!hasUpper || !hasLower) suggestions.push('大文字と小文字を混在させてください');
  if (!hasDigit) suggestions.push('数字を含めてください');
  if (!hasSymbol) suggestions.push('記号 (!@#$ など) を追加するとさらに強固になります');

  let score: 0 | 1 | 2 | 3 | 4 = 1;
  let label = '弱い';
  if (entropyBits >= 85 && passphrase.length >= 14) {
    score = 4;
    label = '非常に強力';
  } else if (entropyBits >= 62 && passphrase.length >= 10) {
    score = 3;
    label = '強力';
  } else if (entropyBits >= 42 && passphrase.length >= 8) {
    score = 2;
    label = '標準';
  }

  return { score, label, entropyBits, suggestions };
}

const PASSPHRASE_SYLLABLES = [
  'kagi', 'mori', 'sora', 'nami', 'yuki', 'kaze', 'hoshi', 'tsuki',
  'hikari', 'akari', 'midori', 'ao', 'shiro', 'tetsu', 'ishi', 'kumo',
  'mizu', 'yama', 'tani', 'umi', 'shio', 'haru', 'aki', 'fuyu',
  'natsu', 'sakura', 'take', 'matsu', 'ume', 'kiri', 'suzu', 'tate',
];

export function generateStrongPassphrase(wordCount = 4): string {
  const words: string[] = [];
  const randoms = new Uint32Array(wordCount + 2);
  globalThis.crypto.getRandomValues(randoms);

  for (let i = 0; i < wordCount; i++) {
    const word = PASSPHRASE_SYLLABLES[randoms[i] % PASSPHRASE_SYLLABLES.length];
    words.push(i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word);
  }
  const num = (randoms[wordCount] % 90) + 10;
  const symbols = ['!', '#', '$', '%', '&', '@'];
  const sym = symbols[randoms[wordCount + 1] % symbols.length];

  return `${words.join('-')}${sym}${num}`;
}
