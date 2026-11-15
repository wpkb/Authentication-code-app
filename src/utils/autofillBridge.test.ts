import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAutofillBookmarkletCode,
  extractDomainLabel,
  inferServiceLoginUrl,
} from './autofillBridge';

test('inferServiceLoginUrl resolves known issuers and respects custom valid URLs', () => {
  assert.equal(inferServiceLoginUrl('GitHub'), 'https://github.com/login');
  assert.equal(inferServiceLoginUrl('AWS Root Console'), 'https://signin.aws.amazon.com/');
  assert.equal(inferServiceLoginUrl('Google Workspace'), 'https://accounts.google.com/');
  assert.equal(
    inferServiceLoginUrl('Custom App', 'example.org/2fa'),
    'https://example.org/2fa'
  );
  assert.equal(
    inferServiceLoginUrl('Custom App', 'https://auth.myservice.jp/login'),
    'https://auth.myservice.jp/login'
  );
  assert.equal(inferServiceLoginUrl('Custom App', 'javascript:alert(1)'), null);
  assert.equal(inferServiceLoginUrl('Unknown Private Service'), null);
});

test('extractDomainLabel strips www prefix cleanly', () => {
  assert.equal(extractDomainLabel('https://www.npmjs.com/login'), 'npmjs.com');
  assert.equal(extractDomainLabel('https://github.com/login'), 'github.com');
  assert.equal(extractDomainLabel(null), '');
});

test('buildAutofillBookmarkletCode generates safe one-tap script targeting one-time-code inputs', () => {
  const href = buildAutofillBookmarkletCode();
  assert.ok(href.startsWith('javascript:'));
  const decoded = decodeURIComponent(href.slice('javascript:'.length));
  assert.ok(decoded.includes('autocomplete="one-time-code"'));
  assert.ok(decoded.includes('HTMLInputElement.prototype'));
  assert.ok(decoded.includes('navigator.clipboard.readText'));
  assert.ok(!decoded.includes('alert('));
  assert.ok(!decoded.includes('window.open('));
});
