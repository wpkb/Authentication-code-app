export const LAST_ACTIVITY_MS_KEY = 'kv_last_activity_ms';
export const AUTO_LOCK_MINUTES_KEY = 'kv_auto_lock_minutes';
export const HAS_UNLOCKED_SESSION_KEY = 'kv_has_unlocked_session';

export interface AutoLockExpiryResult {
  expired: boolean;
  idleMinutes: number;
  thresholdMinutes: number;
}

export function isAutoLockExpired(params: {
  nowMs: number;
  lastActivityMs: number | null;
  autoLockMinutes: number;
}): AutoLockExpiryResult {
  const { nowMs, lastActivityMs, autoLockMinutes } = params;
  if (!Number.isFinite(autoLockMinutes) || autoLockMinutes <= 0) {
    return { expired: false, idleMinutes: 0, thresholdMinutes: 0 };
  }
  if (lastActivityMs === null || !Number.isFinite(lastActivityMs) || lastActivityMs <= 0) {
    return { expired: false, idleMinutes: 0, thresholdMinutes: autoLockMinutes };
  }

  const idleMs = Math.max(0, nowMs - lastActivityMs);
  const idleMinutes = Math.floor(idleMs / 60_000);
  return {
    expired: idleMs >= autoLockMinutes * 60_000,
    idleMinutes,
    thresholdMinutes: autoLockMinutes,
  };
}

export function readPersistedLastActivityMs(): number | null {
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_MS_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function readPersistedAutoLockMinutes(fallback = 15): number {
  try {
    const raw = localStorage.getItem(AUTO_LOCK_MINUTES_KEY);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function recordUnlockedActivity(
  autoLockMinutes: number,
  nowMs: number = Date.now()
): void {
  try {
    localStorage.setItem(LAST_ACTIVITY_MS_KEY, String(Math.floor(nowMs)));
    localStorage.setItem(AUTO_LOCK_MINUTES_KEY, String(autoLockMinutes));
    localStorage.setItem(HAS_UNLOCKED_SESSION_KEY, '1');
  } catch {
    // ignore storage errors
  }
}

export function updatePersistedAutoLockMinutes(autoLockMinutes: number): void {
  try {
    localStorage.setItem(AUTO_LOCK_MINUTES_KEY, String(autoLockMinutes));
  } catch {
    // ignore storage errors
  }
}

export function clearUnlockedActivitySession(): void {
  try {
    localStorage.removeItem(HAS_UNLOCKED_SESSION_KEY);
    localStorage.removeItem(LAST_ACTIVITY_MS_KEY);
  } catch {
    // ignore storage errors
  }
}

export function checkPersistedAutoLockExpiry(
  nowMs: number = Date.now()
): AutoLockExpiryResult {
  try {
    const hadSession = localStorage.getItem(HAS_UNLOCKED_SESSION_KEY) === '1';
    if (!hadSession) {
      return {
        expired: false,
        idleMinutes: 0,
        thresholdMinutes: readPersistedAutoLockMinutes(15),
      };
    }
    const lastActivityMs = readPersistedLastActivityMs();
    const autoLockMinutes = readPersistedAutoLockMinutes(15);
    return isAutoLockExpired({ nowMs, lastActivityMs, autoLockMinutes });
  } catch {
    return { expired: false, idleMinutes: 0, thresholdMinutes: 15 };
  }
}
