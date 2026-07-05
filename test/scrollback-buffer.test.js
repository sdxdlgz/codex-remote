import test from 'node:test';
import assert from 'node:assert/strict';

import { ScrollbackBuffer } from '../src/scrollback-buffer.js';

test('ScrollbackBuffer keeps the newest bytes', () => {
  const buffer = new ScrollbackBuffer(5);
  buffer.append('hello');
  buffer.append(' world');
  assert.equal(buffer.toString(), 'world');
  assert.equal(buffer.byteLength, 5);
});

test('ScrollbackBuffer can be cleared', () => {
  const buffer = new ScrollbackBuffer(100);
  buffer.append('abc');
  buffer.clear();
  assert.equal(buffer.toString(), '');
  assert.equal(buffer.byteLength, 0);
});

test('ScrollbackBuffer ignores empty values', () => {
  const buffer = new ScrollbackBuffer(100);
  buffer.append('');
  buffer.append(null);
  assert.equal(buffer.toString(), '');
});
