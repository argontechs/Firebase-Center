import argon2 from 'argon2';

// OWASP argon2id baseline: 19 MiB, 2 iterations, parallelism 1.
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, OPTIONS);
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
