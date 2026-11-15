import type { EncryptedEnvelope, StorageMode, VaultSummary } from '../types/vault';

const MAX_CHUNK_SIZE = 3200;
const MAX_COOKIE_CHUNKS = 10;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year
const PREF_ACTIVE_VAULT = 'kv_active_vault';
const PREF_STORAGE_MODE = 'kv_storage_mode';
const PREF_KNOWN_VAULTS = 'kv_known_vaults';

export interface CookieStoreLike {
  getCookieString(): string;
  setCookie(name: string, value: string, maxAgeSeconds: number): void;
  getOverflow(key: string): string | null;
  setOverflow(key: string, value: string): void;
  removeOverflow(key: string): void;
}

const COOKIE_MIRROR_STORAGE_KEY = 'kagivault_cookie_mirror_v1';

function readCookieMirror(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(COOKIE_MIRROR_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeCookieMirror(name: string, value: string, maxAgeSeconds: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const mirror = readCookieMirror();
    if (maxAgeSeconds <= 0) {
      delete mirror[name];
    } else {
      mirror[name] = value;
    }
    localStorage.setItem(COOKIE_MIRROR_STORAGE_KEY, JSON.stringify(mirror));
  } catch {
    // ignore storage quota errors
  }
}

export function createBrowserCookieStore(): CookieStoreLike {
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  return {
    getCookieString() {
      const rawDocCookie = typeof document !== 'undefined' ? document.cookie : '';
      const docMap = parseCookieString(rawDocCookie);
      const mirror = readCookieMirror();
      let changed = false;
      for (const [k, v] of Object.entries(mirror)) {
        if (!(k in docMap)) {
          docMap[k] = v;
          changed = true;
        }
      }
      if (!changed) return rawDocCookie;
      return Object.entries(docMap)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('; ');
    },
    setCookie(name: string, value: string, maxAgeSeconds: number) {
      writeCookieMirror(name, value, maxAgeSeconds);
      if (typeof document === 'undefined') return;
      const parts = [
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
        `Path=/`,
        isSecure ? `SameSite=None` : `SameSite=Lax`,
        `Max-Age=${maxAgeSeconds}`,
      ];
      if (isSecure) {
        parts.push('Secure');
      }
      document.cookie = parts.join('; ');
    },
    getOverflow(key: string) {
      try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
      } catch {
        return null;
      }
    },
    setOverflow(key: string, value: string) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(key, value);
        }
      } catch {
        // ignore quota errors
      }
    },
    removeOverflow(key: string) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(key);
        }
      } catch {
        // ignore
      }
    },
  };
}

export function parseCookieString(cookieStr: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!cookieStr) return map;
  const pairs = cookieStr.split(';');
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;
    const rawKey = pair.slice(0, eqIndex).trim();
    const rawVal = pair.slice(eqIndex + 1).trim();
    try {
      map[decodeURIComponent(rawKey)] = decodeURIComponent(rawVal);
    } catch {
      map[rawKey] = rawVal;
    }
  }
  return map;
}

export function splitIntoChunks(str: string, chunkSize = MAX_CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < str.length; i += chunkSize) {
    chunks.push(str.slice(i, i + chunkSize));
  }
  return chunks;
}

function getChunkPrefix(vaultId: string): string {
  return `kv_d_${vaultId}_`;
}

function getMetaKey(vaultId: string): string {
  return `kv_m_${vaultId}`;
}

function getOverflowKey(vaultId: string): string {
  return `kagivault_overflow_${vaultId}`;
}

export function writeCookieEnvelope(
  envelope: EncryptedEnvelope,
  store: CookieStoreLike = createBrowserCookieStore()
): { tier: 'cookie' | 'cookie+localStorage'; bytes: number } {
  const serialized = JSON.stringify(envelope);
  const chunks = splitIntoChunks(serialized, MAX_CHUNK_SIZE);
  const existing = parseCookieString(store.getCookieString());
  const prefix = getChunkPrefix(envelope.vaultId);
  const metaKey = getMetaKey(envelope.vaultId);
  const overflowKey = getOverflowKey(envelope.vaultId);

  // Clear old chunks first
  for (const key of Object.keys(existing)) {
    if (key.startsWith(prefix)) {
      store.setCookie(key, '', 0);
    }
  }

  let tier: 'cookie' | 'cookie+localStorage' = 'cookie';

  if (chunks.length <= MAX_COOKIE_CHUNKS) {
    chunks.forEach((chunk, index) => {
      store.setCookie(`${prefix}${index}`, chunk, COOKIE_MAX_AGE_SECONDS);
    });
    store.setCookie(
      metaKey,
      JSON.stringify({
        chunks: chunks.length,
        tier: 'cookie',
        updatedAt: envelope.updatedAt,
        revision: envelope.revision,
      }),
      COOKIE_MAX_AGE_SECONDS
    );
    store.removeOverflow(overflowKey);
  } else {
    // Store first chunks in cookies and overflow remainder safely so browser header limits aren't exceeded
    tier = 'cookie+localStorage';
    store.setOverflow(overflowKey, serialized);
    store.setCookie(
      metaKey,
      JSON.stringify({
        chunks: 0,
        tier: 'cookie+localStorage',
        updatedAt: envelope.updatedAt,
        revision: envelope.revision,
      }),
      COOKIE_MAX_AGE_SECONDS
    );
  }

  // Register in known cookie vaults list
  const known = listCookieVaultSummaries(store);
  const filtered = known.filter((k) => k.vaultId !== envelope.vaultId);
  filtered.unshift({
    vaultId: envelope.vaultId,
    updatedAt: envelope.updatedAt,
    revision: envelope.revision,
    source: 'cookie',
  });
  store.setCookie(PREF_KNOWN_VAULTS, JSON.stringify(filtered.slice(0, 12)), COOKIE_MAX_AGE_SECONDS);

  return { tier, bytes: serialized.length };
}

export function readCookieEnvelope(
  vaultId: string,
  store: CookieStoreLike = createBrowserCookieStore()
): EncryptedEnvelope | null {
  const cookies = parseCookieString(store.getCookieString());
  const metaRaw = cookies[getMetaKey(vaultId)];
  if (!metaRaw) {
    // Check overflow directly just in case
    const overflow = store.getOverflow(getOverflowKey(vaultId));
    if (!overflow) return null;
    try {
      return JSON.parse(overflow) as EncryptedEnvelope;
    } catch {
      return null;
    }
  }

  try {
    const meta = JSON.parse(metaRaw) as { chunks: number; tier: 'cookie' | 'cookie+localStorage' };
    if (meta.tier === 'cookie+localStorage') {
      const overflow = store.getOverflow(getOverflowKey(vaultId));
      if (!overflow) return null;
      return JSON.parse(overflow) as EncryptedEnvelope;
    }

    const prefix = getChunkPrefix(vaultId);
    let combined = '';
    for (let i = 0; i < meta.chunks; i++) {
      const part = cookies[`${prefix}${i}`];
      if (typeof part !== 'string') {
        return null;
      }
      combined += part;
    }
    return JSON.parse(combined) as EncryptedEnvelope;
  } catch {
    return null;
  }
}

export function clearCookieEnvelope(
  vaultId: string,
  store: CookieStoreLike = createBrowserCookieStore()
): void {
  const cookies = parseCookieString(store.getCookieString());
  const prefix = getChunkPrefix(vaultId);
  for (const key of Object.keys(cookies)) {
    if (key.startsWith(prefix)) {
      store.setCookie(key, '', 0);
    }
  }
  store.setCookie(getMetaKey(vaultId), '', 0);
  store.removeOverflow(getOverflowKey(vaultId));

  const known = listCookieVaultSummaries(store).filter((k) => k.vaultId !== vaultId);
  store.setCookie(PREF_KNOWN_VAULTS, JSON.stringify(known), COOKIE_MAX_AGE_SECONDS);
}

export function listCookieVaultSummaries(
  store: CookieStoreLike = createBrowserCookieStore()
): VaultSummary[] {
  const cookies = parseCookieString(store.getCookieString());
  const raw = cookies[PREF_KNOWN_VAULTS];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as VaultSummary[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getActiveVaultIdPref(
  store: CookieStoreLike = createBrowserCookieStore()
): string | null {
  const cookies = parseCookieString(store.getCookieString());
  return cookies[PREF_ACTIVE_VAULT] || null;
}

export function setActiveVaultIdPref(
  vaultId: string | null,
  store: CookieStoreLike = createBrowserCookieStore()
): void {
  if (!vaultId) {
    store.setCookie(PREF_ACTIVE_VAULT, '', 0);
    return;
  }
  store.setCookie(PREF_ACTIVE_VAULT, vaultId, COOKIE_MAX_AGE_SECONDS);
}

export function getStorageModePref(
  store: CookieStoreLike = createBrowserCookieStore()
): StorageMode {
  const cookies = parseCookieString(store.getCookieString());
  const val = cookies[PREF_STORAGE_MODE];
  if (val === 'cloud' || val === 'server' || val === 'cookie' || val === 'auto') {
    return val;
  }
  return 'auto';
}

export function setStorageModePref(
  mode: StorageMode,
  store: CookieStoreLike = createBrowserCookieStore()
): void {
  store.setCookie(PREF_STORAGE_MODE, mode, COOKIE_MAX_AGE_SECONDS);
}
