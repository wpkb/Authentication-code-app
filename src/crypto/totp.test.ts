import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOtpAuthUri,
  decodeBase32,
  encodeBase32,
  formatOtpCode,
  generateTotp,
  parseOtpAuthUri,
} from './totp';

test('Base32 roundtrip encodes and decodes RFC 4648 strings cleanly', () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const bytes = decodeBase32(secret);
  assert.equal(encodeBase32(bytes), secret);

  // Handles spaces, dashes, lowercase, and padding
  const messy = decodeBase32('jbsw-y3dp ehpk 3pxp====');
  assert.deepEqual(messy, bytes);
});

test('RFC 6238 SHA-1 test vector produces exact 8-digit TOTP code', async () => {
  // RFC 6238 Appendix B test secret for SHA-1: "12345678901234567890" -> GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  // At T = 59 seconds (counter = 1), SHA-1 8-digit code must be 94287082
  const res = await generateTotp({
    secret,
    algorithm: 'SHA-1',
    digits: 8,
    period: 30,
    timestampMs: 59_000,
  });
  assert.equal(res.code, '94287082');
  assert.equal(res.remainingSeconds, 1);

  // At T = 1111111109 seconds (counter = 0x023523EC), SHA-1 8-digit code must be 07081804
  const res2 = await generateTotp({
    secret,
    algorithm: 'SHA-1',
    digits: 8,
    period: 30,
    timestampMs: 1_111_111_109_000,
  });
  assert.equal(res2.code, '07081804');
});

test('RFC 6238 SHA-256 test vector produces exact 8-digit TOTP code', async () => {
  // 32-byte ASCII "12345678901234567890123456789012"
  const rawBytes = new TextEncoder().encode('12345678901234567890123456789012');
  const secret = encodeBase32(rawBytes);

  const res = await generateTotp({
    secret,
    algorithm: 'SHA-256',
    digits: 8,
    period: 30,
    timestampMs: 59_000,
  });
  assert.equal(res.code, '46119246');
});

test('otpauth URI parser and builder roundtrip preserves metadata', () => {
  const uri =
    'otpauth://totp/GitHub:dev%40example.jp?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA256&digits=8&period=60';
  const parsed = parseOtpAuthUri(uri);
  assert.equal(parsed.issuer, 'GitHub');
  assert.equal(parsed.label, 'dev@example.jp');
  assert.equal(parsed.secret, 'JBSWY3DPEHPK3PXP');
  assert.equal(parsed.algorithm, 'SHA-256');
  assert.equal(parsed.digits, 8);
  assert.equal(parsed.period, 60);

  const rebuilt = buildOtpAuthUri(parsed);
  const reparsed = parseOtpAuthUri(rebuilt);
  assert.deepEqual(reparsed, parsed);
});

test('formatOtpCode adds readable spacing for 6 and 8 digits', () => {
  assert.equal(formatOtpCode('123456'), '123 456');
  assert.equal(formatOtpCode('12345678'), '1234 5678');
});
