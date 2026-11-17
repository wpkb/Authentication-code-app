import type { User } from 'firebase/auth';
import type {
  EncryptedEnvelope,
  StorageMode,
  StorageSyncResult,
  VaultSummary,
} from '../types/vault';
import {
  deleteCloudVault,
  listCloudVaults,
  loadCloudVault,
  saveCloudVault,
} from './cloudVault';
import {
  addBrowserKnownVaultId,
  clearCookieEnvelope,
  getActiveVaultIdPref,
  getBrowserKnownVaultIds,
  listCookieVaultSummaries,
  readCookieEnvelope,
  removeBrowserKnownVaultId,
  writeCookieEnvelope,
} from './cookieVault';
import { mergeScopedAvailableVaults } from './vaultScope';

export { mergeScopedAvailableVaults };

export interface ServerHealthStatus {
  available: boolean;
  storage: string;
  writable: boolean;
  latencyMs?: number;
}

export function sanitizeVaultId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export async function checkServerHealth(): Promise<ServerHealthStatus> {
  const start = performance.now();
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return { available: false, storage: 'unavailable', writable: false };
    }
    const data = (await res.json()) as { ok: boolean; storage?: string; writable?: boolean };
    return {
      available: Boolean(data.ok),
      storage: data.storage ?? 'server-fs',
      writable: Boolean(data.writable),
      latencyMs: Math.round(performance.now() - start),
    };
  } catch {
    return { available: false, storage: 'offline', writable: false };
  }
}

export async function listAvailableVaults(user?: User | null): Promise<VaultSummary[]> {
  const cookieList = listCookieVaultSummaries();
  let cloudList: VaultSummary[] = [];

  if (user) {
    try {
      cloudList = await listCloudVaults(user.uid);
    } catch {
      cloudList = [];
    }
  }

  let serverList: Array<{ vaultId: string; updatedAt: string; revision: number }> = [];
  try {
    const res = await fetch('/api/vaults', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json()) as {
        vaults: Array<{ vaultId: string; updatedAt: string; revision: number }>;
      };
      serverList = data.vaults ?? [];
    }
  } catch {
    serverList = [];
  }

  return mergeScopedAvailableVaults({
    cookieVaults: cookieList,
    cloudVaults: cloudList,
    serverVaults: serverList,
    browserKnownVaultIds: getBrowserKnownVaultIds(),
    activeVaultId: getActiveVaultIdPref(),
  });
}

export async function loadEncryptedVault(
  vaultId: string,
  mode: StorageMode = 'auto',
  user?: User | null
): Promise<{
  envelope: EncryptedEnvelope | null;
  source: 'cloud' | 'server' | 'cookie' | null;
  serverAvailable: boolean;
}> {
  const cookieCopy = readCookieEnvelope(vaultId);

  if (mode === 'cookie') {
    return {
      envelope: cookieCopy,
      source: cookieCopy ? 'cookie' : null,
      serverAvailable: false,
    };
  }

  let cloudCopy: EncryptedEnvelope | null = null;
  if (user && (mode === 'cloud' || mode === 'auto')) {
    try {
      cloudCopy = await loadCloudVault(user.uid, vaultId);
    } catch {
      cloudCopy = null;
    }
  }

  let serverCopy: EncryptedEnvelope | null = null;
  let serverAvailable = false;

  if (mode !== 'cloud') {
    try {
      const res = await fetch(`/api/vaults/${encodeURIComponent(vaultId)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (res.ok) {
        serverAvailable = true;
        const data = (await res.json()) as {
          exists?: boolean;
          envelope?: EncryptedEnvelope | null;
        };
        if (data.exists !== false && data.envelope) {
          serverCopy = data.envelope;
        }
      } else if (res.status === 404) {
        serverAvailable = true;
      }
    } catch {
      serverAvailable = false;
    }
  }

  const candidates: Array<{ env: EncryptedEnvelope; src: 'cloud' | 'server' | 'cookie' }> = [];
  if (cloudCopy) candidates.push({ env: cloudCopy, src: 'cloud' });
  if (serverCopy) candidates.push({ env: serverCopy, src: 'server' });
  if (cookieCopy) candidates.push({ env: cookieCopy, src: 'cookie' });

  if (candidates.length === 0) {
    return { envelope: null, source: null, serverAvailable };
  }

  candidates.sort((a, b) => b.env.revision - a.env.revision);
  return {
    envelope: candidates[0].env,
    source: candidates[0].src,
    serverAvailable,
  };
}

export async function saveEncryptedVault(
  envelope: EncryptedEnvelope,
  mode: StorageMode = 'auto',
  user?: User | null
): Promise<StorageSyncResult> {
  addBrowserKnownVaultId(envelope.vaultId);
  if (mode === 'cookie') {
    const cookieRes = writeCookieEnvelope(envelope);
    return {
      savedTo: 'cookie-only',
      cloudSynced: false,
      serverSynced: false,
      cookieSynced: true,
      cookieTier: cookieRes.tier,
      cookieBytes: cookieRes.bytes,
    };
  }

  if (mode === 'cloud' && user) {
    let cloudSynced = false;
    let cloudError: string | undefined;
    try {
      await saveCloudVault(user, envelope);
      cloudSynced = true;
    } catch (err) {
      cloudError =
        err instanceof Error
          ? 'クラウド保存に失敗したため、暗号化Cookieに退避保存しました。'
          : 'クラウド保存エラー';
    }

    const cookieRes = writeCookieEnvelope(envelope);
    return {
      savedTo: cloudSynced ? 'cloud+cookie' : 'cookie-only',
      cloudSynced,
      serverSynced: false,
      cookieSynced: true,
      cookieTier: cookieRes.tier,
      cookieBytes: cookieRes.bytes,
      error: cloudError,
    };
  }

  let serverSynced = false;
  let serverError: string | undefined;

  try {
    const res = await fetch(`/api/vaults/${encodeURIComponent(envelope.vaultId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ envelope }),
    });
    if (res.ok) {
      serverSynced = true;
    } else {
      const errBody = await res.json().catch(() => ({}));
      serverError =
        (errBody as { error?: string }).error || `サーバー保存エラー (${res.status})`;
    }
  } catch {
    serverError = 'サーバーに接続できないため、暗号化Cookieに保存しました。';
  }

  // Also mirror to Firestore automatically in 'auto' mode if signed in
  let cloudSynced = false;
  if (mode === 'auto' && user) {
    try {
      await saveCloudVault(user, envelope);
      cloudSynced = true;
    } catch {
      cloudSynced = false;
    }
  }

  if (mode === 'auto' || !serverSynced) {
    const cookieRes = writeCookieEnvelope(envelope);
    return {
      savedTo: cloudSynced
        ? 'cloud+cookie'
        : serverSynced
        ? 'server+cookie'
        : 'cookie-only',
      cloudSynced,
      serverSynced,
      cookieSynced: true,
      cookieTier: cookieRes.tier,
      cookieBytes: cookieRes.bytes,
      error: serverSynced || cloudSynced ? undefined : serverError,
    };
  }

  return {
    savedTo: 'server-only',
    cloudSynced: false,
    serverSynced: true,
    cookieSynced: false,
    cookieTier: 'none',
    cookieBytes: 0,
  };
}

export async function deleteVaultEverywhere(
  vaultId: string,
  user?: User | null
): Promise<void> {
  removeBrowserKnownVaultId(vaultId);
  clearCookieEnvelope(vaultId);
  if (user) {
    try {
      await deleteCloudVault(user.uid, vaultId);
    } catch {
      // ignore
    }
  }
  try {
    await fetch(`/api/vaults/${encodeURIComponent(vaultId)}`, {
      method: 'DELETE',
    });
  } catch {
    // ignore offline delete error
  }
}
