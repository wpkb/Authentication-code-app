import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectSnapshotsToPrune,
  shouldCreateAutoBackupSnapshot,
} from './autoBackupStore';

test('shouldCreateAutoBackupSnapshot deduplicates identical checksums on auto-change', () => {
  assert.equal(
    shouldCreateAutoBackupSnapshot({
      latestSnapshot: null,
      newEnvelope: { checksum: 'abc', revision: 1 },
      reason: 'auto-change',
      frequency: 'on-change',
    }),
    true
  );

  assert.equal(
    shouldCreateAutoBackupSnapshot({
      latestSnapshot: {
        checksum: 'abc',
        revision: 1,
        createdAt: '2026-11-15T10:00:00.000Z',
      },
      newEnvelope: { checksum: 'abc', revision: 1 },
      reason: 'auto-change',
      frequency: 'on-change',
    }),
    false
  );

  assert.equal(
    shouldCreateAutoBackupSnapshot({
      latestSnapshot: {
        checksum: 'abc',
        revision: 1,
        createdAt: '2026-11-15T10:00:00.000Z',
      },
      newEnvelope: { checksum: 'def', revision: 2 },
      reason: 'auto-change',
      frequency: 'on-change',
    }),
    true
  );

  // Manual backup always runs even when checksum matches
  assert.equal(
    shouldCreateAutoBackupSnapshot({
      latestSnapshot: {
        checksum: 'abc',
        revision: 1,
        createdAt: '2026-11-15T10:00:00.000Z',
      },
      newEnvelope: { checksum: 'abc', revision: 1 },
      reason: 'manual',
      frequency: 'on-change',
    }),
    true
  );
});

test('shouldCreateAutoBackupSnapshot enforces schedule interval and off state', () => {
  const baseMs = Date.parse('2026-11-15T10:00:00.000Z');
  assert.equal(
    shouldCreateAutoBackupSnapshot({
      latestSnapshot: {
        checksum: 'abc',
        revision: 1,
        createdAt: '2026-11-15T10:00:00.000Z',
      },
      newEnvelope: { checksum: 'def', revision: 2 },
      reason: 'auto-schedule',
      frequency: 'every-15m',
      nowMs: baseMs + 10 * 60_000,
    }),
    false
  );

  assert.equal(
    shouldCreateAutoBackupSnapshot({
      latestSnapshot: {
        checksum: 'abc',
        revision: 1,
        createdAt: '2026-11-15T10:00:00.000Z',
      },
      newEnvelope: { checksum: 'def', revision: 2 },
      reason: 'auto-schedule',
      frequency: 'every-15m',
      nowMs: baseMs + 16 * 60_000,
    }),
    true
  );

  assert.equal(
    shouldCreateAutoBackupSnapshot({
      latestSnapshot: null,
      newEnvelope: { checksum: 'abc', revision: 1 },
      reason: 'auto-change',
      frequency: 'off',
    }),
    false
  );
});

test('selectSnapshotsToPrune keeps newest maxSnapshots and prunes oldest', () => {
  const toPrune = selectSnapshotsToPrune(
    [
      { id: 'old-1', createdAt: '2026-11-15T08:00:00.000Z' },
      { id: 'new-1', createdAt: '2026-11-15T11:00:00.000Z' },
      { id: 'mid-1', createdAt: '2026-11-15T09:00:00.000Z' },
      { id: 'new-2', createdAt: '2026-11-15T10:00:00.000Z' },
    ],
    2
  );
  assert.deepEqual(toPrune, ['mid-1', 'old-1']);
});
