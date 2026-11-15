import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearCookieEnvelope,
  listCookieVaultSummaries,
  readCookieEnvelope,
  writeCookieEnvelope,
  type CookieStoreLike,
} from './cookieVault';
import type { EncryptedEnvelope } from '../types/vault';

function createMemoryCookieStore(): CookieStoreLike {
  const cookies = new Map<string, string>();
  const overflow = new Map<string, string>();
  return {
    getCookieString() {
      return Array.from(cookies.entries())
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('; ');
    },
    setCookie(name, value, maxAgeSeconds) {
      if (maxAgeSeconds <= 0) {
        cookies.delete(name);
      } else {
        cookies.set(name, value);
      }
    },
    getOverflow(key) {
      return overflow.get(key) ?? null;
    },
    setOverflow(key, value) {
      overflow.set(key, value);
    },
    removeOverflow(key) {
      overflow.delete(key);
    },
  };
}

test('chunked cookie storage writes, reads, and clears encrypted envelopes', () => {
  const store = createMemoryCookieStore();
  const envelope: EncryptedEnvelope = {
    version: 1,
    vaultId: 'cookie-test',
    kdf: 'PBKDF2-SHA256',
    iterations: 600_000,
    cipher: 'AES-256-GCM',
    salt: 'c2FsdA==',
    iv: 'aXY=',
    ciphertext: 'X'.repeat(8500), // Forces multi-cookie chunking (> 3200 bytes)
    checksum: 'a'.repeat(64),
    updatedAt: '2026-11-14T00:00:00.000Z',
    revision: 2,
  };

  const writeRes = writeCookieEnvelope(envelope, store);
  assert.equal(writeRes.tier, 'cookie');

  const loaded = readCookieEnvelope('cookie-test', store);
  assert.deepEqual(loaded, envelope);

  const list = listCookieVaultSummaries(store);
  assert.equal(list.length, 1);
  assert.equal(list[0].vaultId, 'cookie-test');

  clearCookieEnvelope('cookie-test', store);
  assert.equal(readCookieEnvelope('cookie-test', store), null);
  assert.equal(listCookieVaultSummaries(store).length, 0);
});
