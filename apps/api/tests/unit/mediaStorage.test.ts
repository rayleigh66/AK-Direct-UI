import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  readStoredImage,
  sniffImageMime,
  storeImage,
  validateImageBuffer,
} from '../../src/media/storage.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'ascii'),
]);

describe('media storage validation', () => {
  let root = '';

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'aoking-media-unit-'));
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('detects JPEG, PNG and WebP signatures', () => {
    expect(sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(sniffImageMime(PNG)).toBe('image/png');
    expect(sniffImageMime(WEBP)).toBe('image/webp');
    expect(sniffImageMime(Buffer.from('not an image'))).toBeNull();
  });

  it('rejects mismatched declared types and non-images', () => {
    expect(() => validateImageBuffer(PNG, 'image/png')).not.toThrow();
    expect(() => validateImageBuffer(PNG, 'image/jpeg')).toThrow(/does not match/);
    expect(() => validateImageBuffer(Buffer.from('hello'), 'image/png')).toThrow(/JPEG, PNG or WebP/);
    expect(() => validateImageBuffer(Buffer.alloc(0), 'image/png')).toThrow(/empty/);
  });

  it('stores a file outside the web root and reads it back by key', async () => {
    const stored = await storeImage(PNG, 'image/png', root);
    expect(stored.storageKey).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(stored.byteSize).toBe(PNG.length);
    expect(stored.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(readStoredImage(root, stored.storageKey)).resolves.toEqual(PNG);
  });

  it('refuses traversal-style storage keys', async () => {
    await expect(readStoredImage(root, '../../etc/passwd')).rejects.toThrow(/not found/i);
  });
});
