import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base64UrlDecode,
  base64UrlEncode,
  parseAuthenticatorDataFlags,
  translateBiometricError,
  verifyAssertionResponseFields,
} from './biometricVault';

function makeAuthData(flagsByte: number): Uint8Array {
  const buf = new Uint8Array(37);
  buf[32] = flagsByte;
  return buf;
}

test('base64UrlEncode and base64UrlDecode round-trip arbitrary bytes', () => {
  const sample = new Uint8Array([0, 1, 63, 62, 255, 128, 42, 99]);
  const encoded = base64UrlEncode(sample);
  assert.ok(!encoded.includes('+'));
  assert.ok(!encoded.includes('/'));
  assert.ok(!encoded.includes('='));
  const decoded = base64UrlDecode(encoded);
  assert.deepEqual(decoded, sample);
});

test('parseAuthenticatorDataFlags extracts UP and UV bits accurately', () => {
  const uvPresent = parseAuthenticatorDataFlags(makeAuthData(0x05)); // UP (0x01) + UV (0x04)
  assert.equal(uvPresent.userPresent, true);
  assert.equal(uvPresent.userVerified, true);

  const upOnly = parseAuthenticatorDataFlags(makeAuthData(0x01)); // UP only, UV missing
  assert.equal(upOnly.userPresent, true);
  assert.equal(upOnly.userVerified, false);

  assert.throws(() => parseAuthenticatorDataFlags(new Uint8Array(10)));
});

test('verifyAssertionResponseFields enforces matching credentialId and UV flag', () => {
  const rawId = new Uint8Array([10, 20, 30, 40, 50]);
  const expectedB64 = base64UrlEncode(rawId);

  const ok = verifyAssertionResponseFields({
    expectedCredentialIdB64: expectedB64,
    actualRawId: rawId,
    authenticatorData: makeAuthData(0x05),
  });
  assert.equal(ok.userVerified, true);

  assert.throws(() =>
    verifyAssertionResponseFields({
      expectedCredentialIdB64: expectedB64,
      actualRawId: new Uint8Array([99, 99, 99]),
      authenticatorData: makeAuthData(0x05),
    })
  );

  assert.throws(() =>
    verifyAssertionResponseFields({
      expectedCredentialIdB64: expectedB64,
      actualRawId: rawId,
      authenticatorData: makeAuthData(0x01), // Missing UV bit
    })
  );
});

test('translateBiometricError produces clear Japanese messages', () => {
  const cancelled = translateBiometricError(
    new DOMException('User cancelled', 'NotAllowedError'),
    false
  );
  assert.match(cancelled, /キャンセル/);

  const iframeBlocked = translateBiometricError(
    new DOMException('Blocked in iframe', 'NotAllowedError'),
    true
  );
  assert.match(iframeBlocked, /新しいタブ/);
});
