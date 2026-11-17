import test from 'node:test';
import assert from 'node:assert/strict';
import { planDemoVaultStart } from './demoVaultPolicy';
import type { EncryptedEnvelope, VaultPayload } from '../types/vault';

const freshPayload: VaultPayload = {
  vaultId: 'demo-vault',
  vaultName: 'デモボルト',
  accounts: [],
  autoLockMinutes: 15,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

test('reuses existing demo-vault salt, iterations, and accounts when already initialized', () => {
  const existingEnvelope: EncryptedEnvelope = {
    version: 1,
    vaultId: 'demo-vault',
    kdf: 'PBKDF2-SHA256',
    iterations: 600000,
    cipher: 'AES-256-GCM',
    salt: 'EXISTING_SALT_B64',
    iv: 'IV',
    ciphertext: 'CT',
    checksum: 'a'.repeat(64),
    updatedAt: '2026-01-02T00:00:00Z',
    revision: 4,
  };
  const existingDecrypted: VaultPayload = {
    ...freshPayload,
    vaultName: '既存デモ',
    updatedAt: '2026-01-02T00:00:00Z',
  };

  const plan = planDemoVaultStart({
    existingEnvelope,
    existingDecrypted,
    freshPayload,
    defaultIterations: 600000,
  });

  assert.equal(plan.reuseExisting, true);
  assert.equal(plan.saltB64, 'EXISTING_SALT_B64');
  assert.equal(plan.revision, 4);
  assert.equal(plan.payload.vaultName, '既存デモ');
});

test('creates fresh demo-vault when none exists', () => {
  const plan = planDemoVaultStart({
    existingEnvelope: null,
    existingDecrypted: null,
    freshPayload,
    defaultIterations: 600000,
  });

  assert.equal(plan.reuseExisting, false);
  assert.equal(plan.saltB64, undefined);
  assert.equal(plan.revision, 1);
});
