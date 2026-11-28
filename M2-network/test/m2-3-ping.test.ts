import { describe, expect, it } from "vitest";
import { PingMeter } from "../src/metrics/pingMeter.js";

describe("M2-3 ping and measurements", () => {
  it("finds round trip time, clock offset, frame rate and the last state", () => {
    let t = 1000;
    const m = new PingMeter(() => t);
    const p = m.ping(7);
    t += 40;
    // The phone clock is 5000 ms ahead; it answered in the middle of the round trip.
    const s = m.pong(7, { id: p.id, ct: 1000 + 20 + 5000, fps: 58, last: 123 });
    expect(s).toMatchObject({ rttMs: 40, offsetMs: 5000, fps: 58, lastState: 123, jitterMs: 0 });
  });

  it("smooths the change of the round trip time into the jitter", () => {
    let t = 0;
    const m = new PingMeter(() => t);
    const rtts = [20, 60, 20, 60, 20, 60, 20, 60];
    let last;
    for (const rtt of rtts) {
      const p = m.ping(1);
      t += rtt;
      last = m.pong(1, { id: p.id, ct: t, fps: 60, last: 0 });
      t += 500 - rtt;
    }
    expect(last!.rttMs).toBe(60);
    // Every step changes by 40 ms, so the jitter grows towards 40 by 1/16 of the gap each time:
    // after 7 changes J = 40 · (1 − (15/16)^7).
    expect(last!.jitterMs).toBeCloseTo(40 * (1 - (15 / 16) ** 7), 9);
  });

  it("drops answers that are wrong, unknown or for another link", () => {
    const m = new PingMeter(() => 0);
    const p = m.ping(1);
    expect(m.pong(2, { id: p.id, ct: 0, fps: 60, last: 0 })).toBeUndefined();
    expect(m.pong(1, { id: 999, ct: 0, fps: 60, last: 0 })).toBeUndefined();
    expect(m.pong(1, { id: p.id, ct: Number.NaN, fps: 60, last: 0 })).toBeUndefined();
    expect(m.pong(1, { id: p.id, ct: 0, fps: -1, last: 0 })).toBeUndefined();
    expect(m.pong(1, { id: p.id, ct: 0, fps: 60, last: 1.5 })).toBeUndefined();
    expect(m.pong(1, "pong")).toBeUndefined();
    expect(m.pong(1, { id: p.id, ct: 0, fps: 60, last: -1 })).toBeDefined();
    // The same answer twice counts once.
    expect(m.pong(1, { id: p.id, ct: 0, fps: 60, last: -1 })).toBeUndefined();
  });

  it("a newer answer makes older open pings count as lost; closed links are forgotten", () => {
    let t = 0;
    const m = new PingMeter(() => t);
    const a = m.ping(1);
    const b = m.ping(1);
    t = 30;
    expect(m.pong(1, { id: b.id, ct: 0, fps: 60, last: 0 })?.rttMs).toBe(30);
    expect(m.pong(1, { id: a.id, ct: 0, fps: 60, last: 0 })).toBeUndefined();
    expect(m.get(1)).toMatchObject({ sent: 2, answered: 1 });
    m.keep([2]);
    expect(m.get(1)).toBeUndefined();
  });
});
