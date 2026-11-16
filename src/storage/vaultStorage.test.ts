import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeScopedAvailableVaults } from './vaultScope';

test('mergeScopedAvailableVaults hides foreign server vaults from fresh logged-out visitors', () => {
  const result = mergeScopedAvailableVaults({
    cookieVaults: [],
    cloudVaults: [],
    serverVaults: [
      { vaultId: 'someone-elses-demo', updatedAt: '2026-11-15T12:00:00.000Z', revision: 4 },
      { vaultId: 'shared-host-vault', updatedAt: '2026-11-15T11:00:00.000Z', revision: 2 },
    ],
    browserKnownVaultIds: [],
    activeVaultId: null,
  });

  assert.equal(result.length, 0);
});

test('mergeScopedAvailableVaults includes own browser/cookie/cloud vaults and merges newer revisions', () => {
  const result = mergeScopedAvailableVaults({
    cookieVaults: [
      { vaultId: 'my-local', updatedAt: '2026-11-15T10:00:00.000Z', revision: 1, source: 'cookie' },
    ],
    cloudVaults: [
      { vaultId: 'cloud-main', updatedAt: '2026-11-15T12:00:00.000Z', revision: 5, source: 'cloud' },
    ],
    serverVaults: [
      { vaultId: 'my-local', updatedAt: '2026-11-15T12:30:00.000Z', revision: 3 },
      { vaultId: 'stranger-vault', updatedAt: '2026-11-15T13:00:00.000Z', revision: 9 },
    ],
    browserKnownVaultIds: ['my-local'],
    activeVaultId: null,
  });

  assert.equal(result.length, 2);
  assert.equal(result[0].vaultId, 'my-local');
  assert.equal(result[0].source, 'both');
  assert.equal(result[0].revision, 3);
  assert.equal(result[1].vaultId, 'cloud-main');
  assert.equal(result.some((v) => v.vaultId === 'stranger-vault'), false);
});
