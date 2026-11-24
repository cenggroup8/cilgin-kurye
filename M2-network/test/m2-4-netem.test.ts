import { describe, expect, it } from "vitest";
import { NetemQueue, NetemSettings, type Scheduler, seededRandom } from "../src/netem/netem.js";

/** A clock that only moves when the test says so. */
class FakeClock implements Scheduler {
  t = 0;
  private jobs: { at: number; n: number; fn: () => void }[] = [];
  private n = 0;
  now(): number {
    return this.t;
  }
  after(ms: number, fn: () => void): void {
    this.jobs.push({ at: this.t + Math.max(0, ms), n: this.n++, fn });
  }
  run(until: number): void {
    for (;;) {
      this.jobs.sort((a, b) => a.at - b.at || a.n - b.n);
      const j = this.jobs[0];
      if (!j || j.at > until) break;
      this.jobs.shift();
      this.t = j.at;
      j.fn();
    }
    this.t = until;
  }
}

function measure(settings: { delayMs: number; jitterMs: number; lossPct: number }, count: number, droppable = true, ordered = false) {
  const clock = new FakeClock();
  const got: { id: number; delay: number }[] = [];
  const sentAt = new Map<number, number>();
  const q = new NetemQueue<number>((id) => got.push({ id, delay: clock.now() - sentAt.get(id)! }), {
    scheduler: clock,
    random: seededRandom(42),
    ordered,
  });
  q.settings = settings;
  for (let i = 0; i < count; i++) {
    sentAt.set(i, clock.now());
    q.push(i, droppable);
    clock.run(clock.now() + 10); // one message every 10 ms
  }
  clock.run(clock.now() + 10_000);
  return { got, stats: q.stats };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("network emulator queue", () => {
  it("without settings, a message goes through at once", () => {
    const { got } = measure({ delayMs: 0, jitterMs: 0, lossPct: 0 }, 50);
    expect(got).toHaveLength(50);
    expect(got.every((g) => g.delay === 0)).toBe(true);
  });

  it("added delay is measured as set", () => {
    const { got } = measure({ delayMs: 120, jitterMs: 0, lossPct: 0 }, 200);
    expect(got.every((g) => g.delay === 120)).toBe(true);
  });

  it("jitter spreads the delay evenly around the set value", () => {
    const { got } = measure({ delayMs: 100, jitterMs: 40, lossPct: 0 }, 5000);
    const d = got.map((g) => g.delay);
    expect(Math.min(...d)).toBeGreaterThanOrEqual(60);
    expect(Math.max(...d)).toBeLessThanOrEqual(140);
    expect(mean(d)).toBeCloseTo(100, 0);
    // even spread from −40 to +40: standard deviation 40 / √3 ≈ 23
    const sd = Math.sqrt(mean(d.map((x) => (x - 100) ** 2)));
    expect(sd).toBeGreaterThan(20);
    expect(sd).toBeLessThan(26);
  });

  it("loss is measured as set", () => {
    for (const lossPct of [5, 30, 80]) {
      const { stats } = measure({ delayMs: 0, jitterMs: 0, lossPct }, 10_000);
      expect((100 * stats.dropped) / stats.pushed).toBeGreaterThan(lossPct - 1.5);
      expect((100 * stats.dropped) / stats.pushed).toBeLessThan(lossPct + 1.5);
    }
  });

  it("a message that must arrive is never lost, even with 100 % loss", () => {
    const { got, stats } = measure({ delayMs: 50, jitterMs: 30, lossPct: 100 }, 1000, false);
    expect(got).toHaveLength(1000);
    expect(stats.dropped).toBe(0);
  });

  it("an ordered queue (TCP) keeps the order under jitter, an unordered one (UDP) may not", () => {
    const ordered = measure({ delayMs: 50, jitterMs: 45, lossPct: 0 }, 500, false, true).got.map((g) => g.id);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    const free = measure({ delayMs: 50, jitterMs: 45, lossPct: 0 }, 500, false, false).got.map((g) => g.id);
    expect(free).not.toEqual([...free].sort((a, b) => a - b));
  });

  it("the same seed gives the same result", () => {
    const a = measure({ delayMs: 80, jitterMs: 20, lossPct: 10 }, 500);
    const b = measure({ delayMs: 80, jitterMs: 20, lossPct: 10 }, 500);
    expect(a).toEqual(b);
  });
});

describe("network settings from the admin", () => {
  it("takes the parameter names of M1-5 and changes the bound queues at once", () => {
    const s = new NetemSettings();
    const p2 = { up: { settings: s.get(2, "up") }, down: { settings: s.get(2, "down") } };
    const board = { up: { settings: s.get("board", "up") }, down: { settings: s.get("board", "down") } };
    s.bind(2, p2);
    s.bind("board", board);
    expect(s.setParam("net.2.down.delay_ms", 150)).toBe(true);
    expect(s.setParam("net.2.down.loss_pct", 10)).toBe(true);
    expect(s.setParam("board.up.jitter_ms", 30)).toBe(true);
    expect(p2.down.settings).toEqual({ delayMs: 150, jitterMs: 0, lossPct: 10 });
    expect(p2.up.settings).toEqual({ delayMs: 0, jitterMs: 0, lossPct: 0 });
    expect(board.up.settings).toEqual({ delayMs: 0, jitterMs: 30, lossPct: 0 });
  });

  it("other names are not network queue values", () => {
    const s = new NetemSettings();
    for (const n of ["net.8.up.delay_ms", "net.2.fps_limit", "board.state_hz", "physics.grip", "net.2.sideways.delay_ms"]) {
      expect(s.setParam(n, 1)).toBe(false);
    }
  });
});
