import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../http/errors.js';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof ALLOWED_IMAGE_TYPES)[number];

const EXTENSIONS: Record<ImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const STORAGE_KEY = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

export interface StoredImage {
  storageKey: string;
  mimeType: ImageMime;
  byteSize: number;
  sha256: string;
}

/** Detect the real image type from its signature; the declared type must match. */
export function sniffImageMime(buffer: Buffer): ImageMime | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length >= 8 && png.every((value, index) => buffer[index] === value)) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function validateImageBuffer(
  buffer: Buffer,
  declaredMime: string | undefined
): ImageMime {
  if (!buffer.length) {
    throw new HttpError(400, 'empty_image', 'The uploaded file is empty.');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new HttpError(413, 'image_too_large', 'Images must be 4 MB or smaller.');
  }
  const actual = sniffImageMime(buffer);
  if (!actual) {
    throw new HttpError(415, 'unsupported_image', 'Only JPEG, PNG or WebP images are accepted.');
  }
  const declared = (declaredMime ?? '').split(';')[0].trim().toLowerCase();
  if (declared && declared !== 'application/octet-stream' && declared !== actual) {
    throw new HttpError(415, 'image_type_mismatch', 'The file content does not match its declared type.');
  }
  return actual;
}

export async function storeImage(
  buffer: Buffer,
  declaredMime: string | undefined,
  root: string
): Promise<StoredImage> {
  const mimeType = validateImageBuffer(buffer, declaredMime);
  const storageKey = `${randomUUID()}.${EXTENSIONS[mimeType]}`;
  await mkdir(root, { recursive: true });
  const temporaryPath = path.join(root, `.${storageKey}.tmp`);
  const finalPath = path.join(root, storageKey);
  await writeFile(temporaryPath, buffer, { mode: 0o600 });
  await rename(temporaryPath, finalPath);
  return {
    storageKey,
    mimeType,
    byteSize: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

export async function removeStoredImage(root: string, storageKey: string): Promise<void> {
  if (!STORAGE_KEY.test(storageKey)) return;
  await unlink(path.join(root, storageKey)).catch(() => {});
}

export async function readStoredImage(root: string, storageKey: string): Promise<Buffer> {
  if (!STORAGE_KEY.test(storageKey)) {
    throw new HttpError(404, 'image_not_found', 'Image not found.');
  }
  try {
    return await readFile(path.join(root, storageKey));
  } catch {
    throw new HttpError(404, 'image_not_found', 'Image not found.');
  }
}
