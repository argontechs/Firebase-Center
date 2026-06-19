import { randomBytes, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';

export interface EncryptedSecret {
  ciphertext: string; // base64
  nonce: string;      // base64, 12 random bytes
  tag: string;        // base64, GCM auth tag
  keyVersion: number;
}

const NONCE_BYTES = 12;
const KEY_BYTES = 32;

// Reads the master key the Docker entrypoint injects: NUXT_BO_MASTER_KEY (Nuxt runtimeConfig prefix).
// Falls back to the unprefixed BO_MASTER_KEY only for local non-Nuxt unit runs.
// Parses versioned format ("v:b64" or "v2:b64,v1:b64") into a version->key map.
function loadKeys(): Map<number, Buffer> {
  const raw = process.env.NUXT_BO_MASTER_KEY ?? process.env.BO_MASTER_KEY;
  if (!raw) throw new Error('NUXT_BO_MASTER_KEY is not set');
  const map = new Map<number, Buffer>();
  for (const part of raw.split(',')) {
    const idx = part.indexOf(':');
    if (idx === -1) throw new Error('NUXT_BO_MASTER_KEY malformed: expected "<version>:<base64>"');
    const version = Number(part.slice(0, idx).trim());
    const key = Buffer.from(part.slice(idx + 1).trim(), 'base64');
    if (!Number.isInteger(version) || version < 1) throw new Error('NUXT_BO_MASTER_KEY: bad version');
    if (key.length !== KEY_BYTES) throw new Error(`NUXT_BO_MASTER_KEY v${version}: key must be 32 bytes`);
    map.set(version, key);
  }
  return map;
}

function currentVersion(keys: Map<number, Buffer>): number {
  return Math.max(...keys.keys());
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const keys = loadKeys();
  const keyVersion = currentVersion(keys);
  const key = keys.get(keyVersion)!;
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ct.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
    keyVersion,
  };
}

export function decryptSecret(enc: EncryptedSecret): string {
  const keys = loadKeys();
  const key = keys.get(enc.keyVersion);
  if (!key) throw new Error(`unknown key version: ${enc.keyVersion}`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(enc.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(enc.ciphertext, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}

// Non-reversible display fingerprint (write-only UI). Keyed over the current master key so it is
// stable per deployment but cannot be brute-forced into the plaintext from the DB alone.
export function fingerprint(plaintext: string): string {
  const keys = loadKeys();
  const key = keys.get(currentVersion(keys))!;
  return createHmac('sha256', key)
    .update('\x00fp\x00')
    .update(plaintext, 'utf8')
    .digest('hex')
    .slice(0, 16);
}
