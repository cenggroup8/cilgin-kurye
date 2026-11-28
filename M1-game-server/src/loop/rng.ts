// Seed'li rastgele sayı üreteci (M1-1).
// Mulberry32: basit, hızlı, deterministik 32-bit PRNG.
// Bütün M1 paketleri tek bir SeededRng örneğini kullanır; Math.random() yasak.

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** 0 ile 1 arasında (0 dahil, 1 hariç) rastgele ondalık sayı. */
  nextFloat(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  }

  /** min dahil, max dahil rastgele tam sayı. */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }

  /** Diziden rastgele bir eleman seçer. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.nextInt(0, arr.length - 1)]!;
  }

  /** 0 ile 1 arasında bir olasılıkla true döndürür. */
  chance(probability: number): boolean {
    return this.nextFloat() < probability;
  }
}
