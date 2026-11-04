import { randomInt, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

function scryptAsync(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAX_MEMORY },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      }
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = Buffer.from(
    Array.from({ length: 16 }, () => randomInt(0, 256))
  );
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH);
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derivedKey.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algorithm, nRaw, rRaw, pRaw, saltRaw, hashRaw] = stored.split('$');
    if (algorithm !== 'scrypt' || !saltRaw || !hashRaw) return false;
    if (Number(nRaw) !== SCRYPT_N || Number(rRaw) !== SCRYPT_R || Number(pRaw) !== SCRYPT_P) {
      return false;
    }
    const salt = Buffer.from(saltRaw, 'base64');
    const expected = Buffer.from(hashRaw, 'base64');
    if (expected.length !== KEY_LENGTH) return false;
    const actual = await scryptAsync(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function validatePasswordPolicy(
  password: string,
  username?: string
): { valid: boolean; error?: string } {
  if (typeof password !== 'string' || password.length < 12) {
    return { valid: false, error: 'Password must be at least 12 characters.' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password must be at most 128 characters.' };
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one letter and one number.' };
  }
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    return { valid: false, error: 'Password must not contain the username.' };
  }
  return { valid: true };
}

const INITIAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';

/** Cryptographically secure one-time initial password; never persisted in plaintext. */
export function generateInitialPassword(length = 16): string {
  const effectiveLength = Math.max(16, length);
  for (;;) {
    let password = '';
    for (let i = 0; i < effectiveLength; i++) {
      password += INITIAL_ALPHABET[randomInt(0, INITIAL_ALPHABET.length)];
    }
    if (
      /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /[0-9]/.test(password) &&
      /[^A-Za-z0-9]/.test(password)
    ) {
      return password;
    }
  }
}
