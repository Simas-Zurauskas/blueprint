import { randomBytes } from 'node:crypto';

// Randomness is injected (testing §2.4): run ids and the ratification spot-check sample (challenge.md Q1, Q6 step 9)
// come from here, and tests pass a seeded source.

export interface Rand {
  /** A float in [0, 1). */
  next(): number;
  /** n random bytes as lowercase hex. */
  hex(bytes: number): string;
}

export const systemRand: Rand = {
  next: () => randomBytes(4).readUInt32BE(0) / 0x1_0000_0000,
  hex: (bytes) => randomBytes(bytes).toString('hex'),
};

/** mulberry32 — small, fast, and good enough for sampling; never for secrets. */
export function seededRand(seed: number): Rand {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  return {
    next,
    hex: (bytes) =>
      Array.from({ length: bytes }, () =>
        Math.floor(next() * 256)
          .toString(16)
          .padStart(2, '0'),
      ).join(''),
  };
}

/** k distinct items, uniformly, without replacement (a partial Fisher–Yates). Order of the result is the draw order. */
export function sample<T>(items: readonly T[], k: number, rand: Rand): T[] {
  const pool = [...items];
  const n = Math.min(k, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand.next() * (pool.length - i));
    const tmp = pool[i];
    const pick = pool[j];
    if (tmp === undefined || pick === undefined) break;
    pool[i] = pick;
    pool[j] = tmp;
  }
  return pool.slice(0, n);
}
