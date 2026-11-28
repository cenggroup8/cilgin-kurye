// Sabit adımlı oyun döngüsü (M1-1).
// 30 tick/s zamanlayıcı. Drift telafisi yapar.

import type { SeededRng } from "./rng.js";
import type { TickDeps } from "./tick.js";
import type { TickInput } from "./types.js";
import type { WorldState } from "../state/world.js";
import { TICK_RATE } from "../state/world.js";
import { emptyTickInput } from "./types.js";
import { runTick } from "./tick.js";

const TICK_MS = 1000 / TICK_RATE; // ~33.33ms

export type InputProvider = () => TickInput;

export class GameLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastTime = 0;
  private accumulator = 0;

  constructor(
    private readonly world: WorldState,
    private readonly rng: SeededRng,
    private readonly deps: TickDeps,
    private readonly getInput: InputProvider = emptyTickInput,
  ) {}

  start(): void {
    if (this.timer) return;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.schedule();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Run exactly `count` ticks synchronously. For tests and replay. */
  runSync(count: number, inputProvider?: (tick: number) => TickInput): void {
    for (let i = 0; i < count; i++) {
      const input = inputProvider ? inputProvider(this.world.tick) : this.getInput();
      runTick(this.world, input, this.rng, this.deps);
    }
  }

  private schedule(): void {
    this.timer = setTimeout(() => this.step(), 1);
  }

  private step(): void {
    const now = performance.now();
    this.accumulator += now - this.lastTime;
    this.lastTime = now;

    // Run as many ticks as needed to catch up, cap at 5 to avoid spiral
    let ticks = 0;
    while (this.accumulator >= TICK_MS && ticks < 5) {
      const input = this.getInput();
      runTick(this.world, input, this.rng, this.deps);
      this.accumulator -= TICK_MS;
      ticks++;
    }

    // If we're still behind, drop time to avoid growing lag
    if (this.accumulator >= TICK_MS * 5) {
      this.accumulator = 0;
    }

    if (this.timer !== null) this.schedule();
  }
}
