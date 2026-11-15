import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptVault,
  encryptVault,
  evaluatePassphraseStrength,
  generateStrongPassphrase,
} from './vaultCrypto';
import type { VaultPayload } from '../types/vault';

const sampleVault: VaultPayload = {
  vaultId: 'test-vault',
  vaultName: 'テストボルト',
  autoLockMinutes: 5,
  createdAt: '2026-11-14T00:00:00.000Z',
  updatedAt: '2026-11-14T00:00:00.000Z',
  accounts: [
    {
      id: 'acc-1',
      issuer: 'GitHub',
      label: 'alice@example.jp',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA-1',
      digits: 6,
      period: 30,
      folder: '開発',
      favorite: true,
      createdAt: '2026-11-14T00:00:00.000Z',
      updatedAt: '2026-11-14T00:00:00.000Z',
    },
  ],
};

test('AES-256-GCM vault encryption roundtrip succeeds with correct passphrase', async () => {
  const passphrase = 'Correct-Horse-Battery#99';
  // Use 10,000 iterations in unit test for fast execution while verifying full PBKDF2+GCM path
  const envelope = await encryptVault(sampleVault, passphrase, 3, 10_000);
  assert.equal(envelope.cipher, 'AES-256-GCM');
  assert.equal(envelope.kdf, 'PBKDF2-SHA256');
  assert.equal(envelope.revision, 3);
  assert.ok(!envelope.ciphertext.includes('JBSWY3DPEHPK3PXP'));

  const decrypted = await decryptVault(envelope, passphrase);
  assert.deepEqual(decrypted, sampleVault);
});

test('decryption fails with wrong passphrase or tampered ciphertext', async () => {
  const envelope = await encryptVault(sampleVault, 'MyStrongPass!2026', 1, 10_000);

  await assert.rejects(() => decryptVault(envelope, 'WrongPass!2026'));

  // Tamper ciphertext without updating checksum
  const tamperedFirst = envelope.ciphertext[0] === 'A' ? 'B' : 'A';
  const tampered = {
    ...envelope,
    ciphertext: tamperedFirst + envelope.ciphertext.slice(1),
  };
  await assert.rejects(() => decryptVault(tampered, 'MyStrongPass!2026'));

  // Tamper vaultId (AAD mismatch check)
  const crossVault = {
    ...envelope,
    vaultId: 'other-vault',
  };
  await assert.rejects(() => decryptVault(crossVault, 'MyStrongPass!2026'));
});

test('passphrase strength evaluator and generator work accurately', () => {
  assert.equal(evaluatePassphraseStrength('').score, 0);
  assert.equal(evaluatePassphraseStrength('12345').score, 1);

  const generated = generateStrongPassphrase(4);
  const evalResult = evaluatePassphraseStrength(generated);
  assert.ok(evalResult.score >= 3, `Expected score >= 3 for ${generated}, got ${evalResult.score}`);
});
