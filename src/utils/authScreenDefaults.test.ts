import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAuthScreenDefaults,
  resolveAuthVaultStorageMode,
} from './authScreenDefaults';
import type { VaultSummary } from '../types/vault';

test('switches async from create placeholder to unlock when vaults load after mount', () => {
  const vaults: VaultSummary[] = [
    { vaultId: 'demo-vault', updatedAt: '2026-01-01T00:00:00Z', revision: 2, source: 'both' },
  ];
  const decision = computeAuthScreenDefaults({
    googleSignedIn: false,
    availableVaults: vaults,
    initialVaultId: null,
    faceEnrolledVaultIds: ['demo-vault'],
    currentTab: 'create',
    currentVaultId: 'main-vault',
    userEditedTab: false,
    userEditedVaultId: false,
  });

  assert.equal(decision.shouldUpdateTab, true);
  assert.equal(decision.nextTab, 'unlock');
  assert.equal(decision.shouldUpdateVaultId, true);
  assert.equal(decision.nextVaultId, 'demo-vault');
});

test('selects local/server vault when Google user is signed in without cloud vaults', () => {
  const vaults: VaultSummary[] = [
    { vaultId: 'demo-vault', updatedAt: '2026-01-01T00:00:00Z', revision: 1, source: 'server' },
  ];
  const decision = computeAuthScreenDefaults({
    googleSignedIn: true,
    availableVaults: vaults,
    initialVaultId: null,
    faceEnrolledVaultIds: ['demo-vault'],
    currentTab: 'create',
    currentVaultId: 'cloud-main',
    userEditedTab: false,
    userEditedVaultId: false,
  });

  assert.equal(decision.shouldUpdateTab, true);
  assert.equal(decision.nextTab, 'unlock');
  assert.equal(decision.shouldUpdateVaultId, true);
  assert.equal(decision.nextVaultId, 'demo-vault');
});

test('respects explicit user tab selection and manual vaultId edits', () => {
  const vaults: VaultSummary[] = [
    { vaultId: 'demo-vault', updatedAt: '2026-01-01T00:00:00Z', revision: 1, source: 'cookie' },
  ];
  const decision = computeAuthScreenDefaults({
    googleSignedIn: false,
    availableVaults: vaults,
    initialVaultId: 'demo-vault',
    faceEnrolledVaultIds: ['demo-vault'],
    currentTab: 'create',
    currentVaultId: 'custom-id',
    userEditedTab: true,
    userEditedVaultId: true,
  });

  assert.equal(decision.shouldUpdateTab, false);
  assert.equal(decision.shouldUpdateVaultId, false);
});

test('resolveAuthVaultStorageMode picks vault summary source instead of stale global mode', () => {
  const vaults: VaultSummary[] = [
    { vaultId: 'demo-vault', updatedAt: '2026-01-01T00:00:00Z', revision: 1, source: 'both' },
    { vaultId: 'cloud-main', updatedAt: '2026-01-02T00:00:00Z', revision: 3, source: 'cloud' },
  ];
  assert.equal(resolveAuthVaultStorageMode('demo-vault', vaults, 'cloud'), 'auto');
  assert.equal(resolveAuthVaultStorageMode('cloud-main', vaults, 'cookie'), 'cloud');
  assert.equal(resolveAuthVaultStorageMode('unknown', vaults, 'server'), 'server');
});
