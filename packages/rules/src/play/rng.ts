// Seeded RNG for server-authoritative rolls. Deterministic under a fixed seed so check and
// combat fixtures replay byte-identically (F15 replay depends on this staying stable).

export type Rng = () => number

/** mulberry32 - tiny, fast, good-enough distribution for dice. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Non-deterministic default for live play. */
export function liveRng(): Rng {
  return Math.random
}

export function rollDie(rng: Rng, sides: number): number {
  return 1 + Math.floor(rng() * sides)
}
