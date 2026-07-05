import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBool, parseCsv, resolveConfig } from '../src/config.js';

test('parseBool accepts common true and false values', () => {
  assert.equal(parseBool('true'), true);
  assert.equal(parseBool('1'), true);
  assert.equal(parseBool('yes'), true);
  assert.equal(parseBool('false', true), false);
  assert.equal(parseBool('0', true), false);
  assert.equal(parseBool(undefined, true), true);
});

test('parseCsv trims empty values', () => {
  assert.deepEqual(parseCsv(' a@example.com, ,b@example.com '), ['a@example.com', 'b@example.com']);
});

test('resolveConfig applies safe defaults', () => {
  const config = resolveConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 8787);
  assert.equal(config.command, 'codex');
  assert.equal(config.autoStart, true);
  assert.equal(config.appAuthToken, '');
  assert.equal(config.authCookieName, 'codex_remote_token');
  assert.equal(config.requireCloudflareAccess, false);
});

test('resolveConfig lowercases access email allowlist', () => {
  const config = resolveConfig({ ACCESS_ALLOWED_EMAILS: 'Me@Example.COM, you@example.com' });
  assert.deepEqual(config.allowedEmails, ['me@example.com', 'you@example.com']);
});
