import type { TotpAccount, TotpAlgorithm } from '../types/vault';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function normalizeBase32(input: string): string {
  return input.replace(/[\s\-_]/g, '').replace(/=+$/, '').toUpperCase();
}

export function decodeBase32(input: string): Uint8Array {
  const clean = normalizeBase32(input);
  if (!clean.length) {
    throw new Error('シークレットキーが空です。Base32形式のキーを入力してください。');
  }

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) {
      throw new Error(`無効なBase32文字が含まれています: "${clean[i]}"`);
    }
    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  if (output.length === 0) {
    throw new Error('有効なバイト列にデコードできませんでした。');
  }

  return new Uint8Array(output);
}

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let result = '';

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;

    while (bits >= 5) {
      result += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return result;
}

export function generateRandomSecret(byteLength = 20): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return encodeBase32(bytes);
}

function toWebCryptoHash(algorithm: TotpAlgorithm): 'SHA-1' | 'SHA-256' | 'SHA-512' {
  switch (algorithm) {
    case 'SHA-256':
      return 'SHA-256';
    case 'SHA-512':
      return 'SHA-512';
    case 'SHA-1':
    default:
      return 'SHA-1';
  }
}

export async function generateHotpForCounter(params: {
  secretBytes: Uint8Array;
  counter: number;
  algorithm?: TotpAlgorithm;
  digits?: 6 | 8;
}): Promise<string> {
  const { secretBytes, counter, algorithm = 'SHA-1', digits = 6 } = params;

  const counterBuffer = new ArrayBuffer(8);
  const view = new DataView(counterBuffer);
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  view.setUint32(0, high, false);
  view.setUint32(4, low, false);

  const keyCopy = new Uint8Array(secretBytes.length);
  keyCopy.set(secretBytes);

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyCopy,
    { name: 'HMAC', hash: { name: toWebCryptoHash(algorithm) } },
    false,
    ['sign']
  );

  const signature = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, counterBuffer);
  const hmac = new Uint8Array(signature);

  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const mod = Math.pow(10, digits);
  const otp = binary % mod;
  return otp.toString().padStart(digits, '0');
}

export interface TotpResult {
  code: string;
  nextCode: string;
  remainingSeconds: number;
  period: 30 | 60;
  counter: number;
}

export async function generateTotp(params: {
  secret: string;
  algorithm?: TotpAlgorithm;
  digits?: 6 | 8;
  period?: 30 | 60;
  timestampMs?: number;
}): Promise<TotpResult> {
  const {
    secret,
    algorithm = 'SHA-1',
    digits = 6,
    period = 30,
    timestampMs = Date.now(),
  } = params;

  const secretBytes = decodeBase32(secret);
  const epochSeconds = Math.floor(timestampMs / 1000);
  const counter = Math.floor(epochSeconds / period);
  const elapsed = epochSeconds % period;
  const remainingSeconds = period - elapsed;

  const [code, nextCode] = await Promise.all([
    generateHotpForCounter({ secretBytes, counter, algorithm, digits }),
    generateHotpForCounter({ secretBytes, counter: counter + 1, algorithm, digits }),
  ]);

  return {
    code,
    nextCode,
    remainingSeconds,
    period,
    counter,
  };
}

export function formatOtpCode(code: string): string {
  if (code.length === 6) {
    return `${code.slice(0, 3)} ${code.slice(3)}`;
  }
  if (code.length === 8) {
    return `${code.slice(0, 4)} ${code.slice(4)}`;
  }
  return code;
}

export interface ParsedOtpAuth {
  issuer: string;
  label: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: 30 | 60;
}

export function parseOtpAuthUri(rawUri: string): ParsedOtpAuth {
  const trimmed = rawUri.trim();
  if (!trimmed.toLowerCase().startsWith('otpauth://totp/')) {
    throw new Error('有効な otpauth://totp/ URI ではありません。');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('URIの構文が不正です。');
  }

  const rawPath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  let pathIssuer = '';
  let label = rawPath;

  const colonIndex = rawPath.indexOf(':');
  if (colonIndex !== -1) {
    pathIssuer = rawPath.slice(0, colonIndex).trim();
    label = rawPath.slice(colonIndex + 1).trim();
  }

  const secretParam = parsed.searchParams.get('secret') ?? '';
  const secret = normalizeBase32(secretParam);
  decodeBase32(secret);

  const queryIssuer = (parsed.searchParams.get('issuer') ?? '').trim();
  const issuer = queryIssuer || pathIssuer || 'サービス';

  const algoParam = (parsed.searchParams.get('algorithm') ?? 'SHA1').toUpperCase();
  let algorithm: TotpAlgorithm = 'SHA-1';
  if (algoParam === 'SHA256' || algoParam === 'SHA-256') {
    algorithm = 'SHA-256';
  } else if (algoParam === 'SHA512' || algoParam === 'SHA-512') {
    algorithm = 'SHA-512';
  }

  const digitsParam = Number(parsed.searchParams.get('digits') ?? '6');
  const digits: 6 | 8 = digitsParam === 8 ? 8 : 6;

  const periodParam = Number(parsed.searchParams.get('period') ?? '30');
  const period: 30 | 60 = periodParam === 60 ? 60 : 30;

  return {
    issuer,
    label: label || 'アカウント',
    secret,
    algorithm,
    digits,
    period,
  };
}

export function buildOtpAuthUri(
  account: Pick<TotpAccount, 'issuer' | 'label' | 'secret' | 'algorithm' | 'digits' | 'period'>
): string {
  const issuer = account.issuer.trim() || 'Service';
  const label = account.label.trim() || 'Account';
  const pathLabel = encodeURIComponent(`${issuer}:${label}`);
  const algo = account.algorithm.replace('-', '');
  const params = new URLSearchParams({
    secret: normalizeBase32(account.secret),
    issuer,
    algorithm: algo,
    digits: String(account.digits),
    period: String(account.period),
  });
  return `otpauth://totp/${pathLabel}?${params.toString()}`;
}
