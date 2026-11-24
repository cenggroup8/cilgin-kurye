import { randomInt } from "node:crypto";

/** The six digit game code that phones type or scan to join. */
export class GameCode {
  private code: string;

  constructor(initial?: string) {
    this.code = initial ?? GameCode.random();
  }

  static random(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, "0");
  }

  get value(): string {
    return this.code;
  }

  /** Makes a new code that is different from the current one. */
  renew(): string {
    let next = GameCode.random();
    while (next === this.code) next = GameCode.random();
    this.code = next;
    return next;
  }

  matches(input: unknown): boolean {
    return typeof input === "string" && input === this.code;
  }
}
