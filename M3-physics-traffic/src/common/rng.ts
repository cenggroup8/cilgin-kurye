/**
 * Seeded random numbers for the whole M3 module.
 *
 * Every part of M3 that needs randomness (NPC turns and spawns, bot steering
 * noise, ...) must use this class and never Math.random(). Then the same seed
 * and the same inputs always give exactly the same game (system rule 5 and R11).
 *
 * Algorithm: mulberry32. Small, fast and good enough for a game.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform number in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Number in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** One element, chosen with the given weights (all >= 0, at least one > 0). */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** A new independent generator, for example one per sub system. */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296));
  }
}
