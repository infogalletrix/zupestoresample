import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const scrypt = promisify(scryptCallback);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
export async function checkPassword(password, encoded) {
  const [salt, hex] = encoded.split(':');
  if (!hex) return false;
  const hash = await scrypt(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export function safeEqual(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function encryption(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const keyPath = join(dataDir, '.encryption-key');
  if (!process.env.ENCRYPTION_KEY && !existsSync(keyPath))
    writeFileSync(keyPath, randomBytes(32).toString('hex'), { mode: 0o600 });
  const key = Buffer.from(
    process.env.ENCRYPTION_KEY || readFileSync(keyPath, 'utf8').trim(),
    'hex',
  );
  if (key.length !== 32)
    throw new Error('ENCRYPTION_KEY must be exactly 64 hexadecimal characters.');
  return {
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final(),
      ]);
      return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${encrypted.toString('hex')}`;
    },
    decrypt(value) {
      const [iv, tag, encrypted] = value.split('.');
      const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
      cipher.setAuthTag(Buffer.from(tag, 'hex'));
      return JSON.parse(
        Buffer.concat([cipher.update(Buffer.from(encrypted, 'hex')), cipher.final()]).toString(
          'utf8',
        ),
      );
    },
  };
}
