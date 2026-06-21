/**
 * mulberry32 — a tiny, fast, deterministic PRNG.
 *
 * Given the same 32-bit seed it always yields the same sequence, which is what
 * lets the whole simulation be reproducible from a single seed (needed for the
 * future "daily shared seed" feature).
 */
export type Rng = () => number

export function makeRng(seed: number): Rng {
  let s = seed >>> 0
  return function next(): number {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
