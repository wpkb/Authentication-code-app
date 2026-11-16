import test from 'node:test';
import assert from 'node:assert/strict';
import type { VaultSummary } from '../types/vault';
import {
  resolveStartupUnlockTarget,
  resolveStorageModeForVault,
} from './startupUnlockTarget';

const SAMPLE_VAULTS: VaultSummary[] = [
  { vaultId: 'work-vault', source: 'both', revision: 3, updatedAt: '2026-11-15T10:00:00.000Z' },
  { vaultId: 'cloud-main', source: 'cloud', revision: 7, updatedAt: '2026-11-15T12:00:00.000Z' },
];

test('resolveStartupUnlockTarget prioritizes enrolled face vault and auto-starts when camera supported', () => {
  const result = resolveStartupUnlockTarget({
    availableVaults: SAMPLE_VAULTS,
    initialVaultId: null,
    faceEnrolledVaultIds: ['cloud-main'],
    cameraSupported: true,
  });

  assert.equal(result.vaultId, 'cloud-main');
  assert.equal(result.storageMode, 'cloud');
  assert.equal(result.faceEnrolled, true);
  assert.equal(result.shouldAutoStartFaceAuth, true);
});

test('resolveStartupUnlockTarget respects preferred initialVaultId when not face-enrolled', () => {
  const result = resolveStartupUnlockTarget({
    availableVaults: SAMPLE_VAULTS,
    initialVaultId: 'work-vault',
    faceEnrolledVaultIds: ['cloud-main'],
    cameraSupported: true,
  });

  assert.equal(result.vaultId, 'work-vault');
  assert.equal(result.storageMode, 'auto');
  assert.equal(result.faceEnrolled, false);
  assert.equal(result.shouldAutoStartFaceAuth, false);
});

test('resolveStartupUnlockTarget disables face auto-start when camera unsupported', () => {
  const result = resolveStartupUnlockTarget({
    availableVaults: SAMPLE_VAULTS,
    initialVaultId: 'cloud-main',
    faceEnrolledVaultIds: ['cloud-main'],
    cameraSupported: false,
  });

  assert.equal(result.vaultId, 'cloud-main');
  assert.equal(result.faceEnrolled, true);
  assert.equal(result.shouldAutoStartFaceAuth, false);
  assert.equal(resolveStorageModeForVault(SAMPLE_VAULTS[0]), 'auto');
});
