import type { EncryptedEnvelope } from '../types/vault';

export type AutoBackupFrequency = 'on-change' | 'every-15m' | 'every-1h' | 'off';

export interface AutoBackupSettings {
  enabled: boolean;
  frequency: AutoBackupFrequency;
  maxSnapshots: number;
  lastBackupAt: string | null;
}

export interface AutoBackupSnapshot {
  id: string;
  vaultId: string;
  revision: number;
  checksum: string;
  accountCount: number;
  bytes: number;
  reason: 'auto-change' | 'auto-schedule' | 'manual';
  createdAt: string;
  envelope: EncryptedEnvelope;
}

const BACKUP_DB_NAME = 'kagivault_auto_backups_v1';
const BACKUP_STORE_NAME = 'snapshots';
const BACKUP_DB_VERSION = 1;
const SETTINGS_KEY = 'kv_auto_backup_settings';

export const DEFAULT_AUTO_BACKUP_SETTINGS: AutoBackupSettings = {
  enabled: true,
  frequency: 'on-change',
  maxSnapshots: 10,
  lastBackupAt: null,
};

export function loadAutoBackupSettings(): AutoBackupSettings {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_AUTO_BACKUP_SETTINGS;
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_AUTO_BACKUP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AutoBackupSettings>;
    const frequency: AutoBackupFrequency =
      parsed.frequency === 'on-change' ||
      parsed.frequency === 'every-15m' ||
      parsed.frequency === 'every-1h' ||
      parsed.frequency === 'off'
        ? parsed.frequency
        : 'on-change';
    const maxSnapshots =
      typeof parsed.maxSnapshots === 'number' && parsed.maxSnapshots >= 1 && parsed.maxSnapshots <= 50
        ? Math.floor(parsed.maxSnapshots)
        : 10;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : frequency !== 'off',
      frequency,
      maxSnapshots,
      lastBackupAt: typeof parsed.lastBackupAt === 'string' ? parsed.lastBackupAt : null,
    };
  } catch {
    return DEFAULT_AUTO_BACKUP_SETTINGS;
  }
}

export function saveAutoBackupSettings(settings: AutoBackupSettings): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota errors
  }
}

export function getFrequencyIntervalMs(frequency: AutoBackupFrequency): number | null {
  if (frequency === 'every-15m') return 15 * 60_000;
  if (frequency === 'every-1h') return 60 * 60_000;
  return null;
}

export function shouldCreateAutoBackupSnapshot(params: {
  latestSnapshot: Pick<AutoBackupSnapshot, 'checksum' | 'revision' | 'createdAt'> | null;
  newEnvelope: Pick<EncryptedEnvelope, 'checksum' | 'revision'>;
  reason: AutoBackupSnapshot['reason'];
  frequency: AutoBackupFrequency;
  nowMs?: number;
}): boolean {
  const { latestSnapshot, newEnvelope, reason, frequency, nowMs = Date.now() } = params;

  if (reason === 'manual') {
    return true;
  }

  if (frequency === 'off') {
    return false;
  }

  if (!latestSnapshot) {
    return true;
  }

  if (reason === 'auto-change') {
    return latestSnapshot.checksum !== newEnvelope.checksum;
  }

  // auto-schedule: only run if interval elapsed AND content changed since latest snapshot
  const intervalMs = getFrequencyIntervalMs(frequency);
  if (intervalMs === null) return false;
  const lastMs = Date.parse(latestSnapshot.createdAt);
  if (!Number.isFinite(lastMs)) return true;
  if (nowMs - lastMs < intervalMs) return false;

  return latestSnapshot.checksum !== newEnvelope.checksum;
}

export function selectSnapshotsToPrune(
  snapshotsForVault: Pick<AutoBackupSnapshot, 'id' | 'createdAt'>[],
  maxSnapshots: number
): string[] {
  const limit = Math.max(1, Math.floor(maxSnapshots));
  if (snapshotsForVault.length <= limit) return [];
  const sortedDesc = [...snapshotsForVault].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
  return sortedDesc.slice(limit).map((s) => s.id);
}

function openBackupDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) {
        const store = db.createObjectStore(BACKUP_STORE_NAME, { keyPath: 'id' });
        store.createIndex('vaultId', 'vaultId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listAutoBackupSnapshots(
  vaultId: string
): Promise<AutoBackupSnapshot[]> {
  try {
    const db = await openBackupDb();
    const list = await new Promise<AutoBackupSnapshot[]>((resolve, reject) => {
      const tx = db.transaction(BACKUP_STORE_NAME, 'readonly');
      const store = tx.objectStore(BACKUP_STORE_NAME);
      const index = store.index('vaultId');
      const req = index.getAll(vaultId);
      req.onsuccess = () => resolve((req.result as AutoBackupSnapshot[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

export async function saveAutoBackupSnapshot(params: {
  envelope: EncryptedEnvelope;
  accountCount: number;
  reason: AutoBackupSnapshot['reason'];
  settings: AutoBackupSettings;
}): Promise<{
  saved: boolean;
  snapshot?: AutoBackupSnapshot;
  snapshots: AutoBackupSnapshot[];
  updatedSettings: AutoBackupSettings;
}> {
  const { envelope, accountCount, reason, settings } = params;
  const existing = await listAutoBackupSnapshots(envelope.vaultId);
  const latest = existing[0] ?? null;

  if (
    !settings.enabled &&
    reason !== 'manual'
  ) {
    return { saved: false, snapshots: existing, updatedSettings: settings };
  }

  if (
    !shouldCreateAutoBackupSnapshot({
      latestSnapshot: latest,
      newEnvelope: envelope,
      reason,
      frequency: settings.frequency,
      nowMs: Date.now(),
    })
  ) {
    return { saved: false, snapshots: existing, updatedSettings: settings };
  }

  const nowIso = new Date().toISOString();
  const serialized = JSON.stringify(envelope);
  const snapshot: AutoBackupSnapshot = {
    id: `bak-${envelope.vaultId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    vaultId: envelope.vaultId,
    revision: envelope.revision,
    checksum: envelope.checksum,
    accountCount,
    bytes: serialized.length,
    reason,
    createdAt: nowIso,
    envelope,
  };

  try {
    const db = await openBackupDb();
    const pruneIds = selectSnapshotsToPrune([snapshot, ...existing], settings.maxSnapshots);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BACKUP_STORE_NAME, 'readwrite');
      const store = tx.objectStore(BACKUP_STORE_NAME);
      store.put(snapshot);
      for (const id of pruneIds) {
        store.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const updatedSettings: AutoBackupSettings = {
      ...settings,
      lastBackupAt: nowIso,
    };
    saveAutoBackupSettings(updatedSettings);
    const refreshed = await listAutoBackupSnapshots(envelope.vaultId);
    return {
      saved: true,
      snapshot,
      snapshots: refreshed,
      updatedSettings,
    };
  } catch {
    return { saved: false, snapshots: existing, updatedSettings: settings };
  }
}

export async function deleteAutoBackupSnapshot(
  snapshotId: string,
  vaultId: string
): Promise<AutoBackupSnapshot[]> {
  try {
    const db = await openBackupDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BACKUP_STORE_NAME, 'readwrite');
      tx.objectStore(BACKUP_STORE_NAME).delete(snapshotId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
  return await listAutoBackupSnapshots(vaultId);
}

export async function clearAutoBackupsForVault(vaultId: string): Promise<void> {
  const snapshots = await listAutoBackupSnapshots(vaultId);
  if (snapshots.length === 0) return;
  try {
    const db = await openBackupDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BACKUP_STORE_NAME, 'readwrite');
      const store = tx.objectStore(BACKUP_STORE_NAME);
      for (const s of snapshots) {
        store.delete(s.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}
