import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '@/env';

/**
 * Password hashing.
 *
 * scrypt from `node:crypto` rather than bcrypt or argon2, deliberately: it is
 * in the standard library, so this adds no native dependency and no compile
 * step, and it is a memory-hard KDF on the same footing as the other two. If
 * this ever moves behind an API, argon2id is the thing to switch to.
 *
 * The mock stores passwords in plaintext and compares them with `!==`. Every
 * row it has written has that shape, which is the clearest single argument for
 * the database this sits on top of.
 */

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

/**
 * Cost parameters.
 *
 * N=16384, r=8, p=1 is the interactive-login end of the usual range and is
 * what OWASP's scrypt guidance suggests for this kind of use. The numbers are
 * written into every hash, so raising them later only re-hashes a user's
 * password the next time they log in instead of invalidating every account.
 */
const PARAMS = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Hex, because a hash is a stored string and this is the encoding Postgres stores well. */
function toHex(buffer: Buffer): string {
  return buffer.toString('hex');
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(pepper(plain), salt, KEY_LENGTH, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, toHex(salt), toHex(derived)].join('$');
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false rather than throwing on anything malformed: a corrupt row is
 * a failed login, not a 500, and saying so loudly would turn a damaged row into
 * an oracle for what is damaged.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const expected = Buffer.from(parts[5] ?? '', 'hex');
  if (expected.length !== KEY_LENGTH) return false;

  const salt = Buffer.from(parts[4] ?? '', 'hex');
  const derived = await scrypt(pepper(plain), salt, expected.length, { N, r, p });

  return timingSafeEqual(derived, expected);
}

/**
 * The pepper is mixed in before hashing, not concatenated to the stored value.
 *
 * Concatenating would leave the real hash in the database where a leaked backup
 * exposes it to offline cracking; mixing in means a database dump alone is not
 * enough to attack. The cost is that forgetting `PASSWORD_PEPPER` locks out
 * every account rather than merely weakening it, which is why it lives in the
 * environment rather than in a file next to the hashes.
 */
function pepper(plain: string): string {
  return env.PASSWORD_PEPPER ? `${env.PASSWORD_PEPPER}${plain}` : plain;
}
