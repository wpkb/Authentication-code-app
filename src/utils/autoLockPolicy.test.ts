import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkPersistedAutoLockExpiry,
  clearUnlockedActivitySession,
  isAutoLockExpired,
  recordUnlockedActivity,
} from './autoLockPolicy.ts';

function withMockLocalStorage(fn: (store: Record<string, string>) => void): void {
  const store: Record<string, string> = {};
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, val: string) => {
        store[key] = String(val);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    },
  });
  try {
    fn(store);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: original,
    });
  }
}

test('isAutoLockExpired returns true when idle time meets or exceeds threshold', () => {
  const now = 1_700_000_000_000;
  const fifteenMinMs = 15 * 60_000;

  assert.deepEqual(
    isAutoLockExpired({ nowMs: now, lastActivityMs: now - fifteenMinMs, autoLockMinutes: 15 }),
    { expired: true, idleMinutes: 15, thresholdMinutes: 15 }
  );

  assert.deepEqual(
    isAutoLockExpired({
      nowMs: now,
      lastActivityMs: now - 22 * 60_000,
      autoLockMinutes: 15,
    }),
    { expired: true, idleMinutes: 22, thresholdMinutes: 15 }
  );
});

test('isAutoLockExpired returns false when under threshold or disabled', () => {
  const now = 1_700_000_000_000;

  assert.deepEqual(
    isAutoLockExpired({
      nowMs: now,
      lastActivityMs: now - 14 * 60_000,
      autoLockMinutes: 15,
    }),
    { expired: false, idleMinutes: 14, thresholdMinutes: 15 }
  );

  assert.deepEqual(
    isAutoLockExpired({
      nowMs: now,
      lastActivityMs: now - 120 * 60_000,
      autoLockMinutes: 0,
    }),
    { expired: false, idleMinutes: 0, thresholdMinutes: 0 }
  );
});

test('checkPersistedAutoLockExpiry detects expired previous session across reloads', () => {
  withMockLocalStorage(() => {
    const t0 = 1_700_000_000_000;
    recordUnlockedActivity(15, t0);

    // 5 minutes later -> still valid
    assert.equal(checkPersistedAutoLockExpiry(t0 + 5 * 60_000).expired, false);

    // 16 minutes later -> expired
    const res = checkPersistedAutoLockExpiry(t0 + 16 * 60_000);
    assert.equal(res.expired, true);
    assert.equal(res.idleMinutes, 16);
    assert.equal(res.thresholdMinutes, 15);

    // After clearing session (explicit lock/signout) -> not reported as newly expired
    clearUnlockedActivitySession();
    assert.equal(checkPersistedAutoLockExpiry(t0 + 30 * 60_000).expired, false);
  });
});
