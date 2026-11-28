import { describe, expect, it } from "vitest";
import { AdminFeed } from "../src/broadcast/adminFeed.js";

describe("M2-3 admin feed", () => {
  it("passes metrics and board data on and keeps two minutes of history", () => {
    let t = 0;
    const sent: any[] = [];
    const feed = new AdminFeed((m) => sent.push(m), { now: () => t });
    for (; t <= 180_000; t += 500) feed.addMetrics([{ name: "net.0.ping_ms", time: t, value: 10 }]);
    expect(sent.filter((m) => m.t === "metrics")).toHaveLength(361);
    feed.addBoard({ connected: true, samples: [{ name: "board.accel_g", time: t, value: 1 }] });
    expect(sent.at(-1)).toEqual({ t: "board", board: { connected: true, samples: [{ name: "board.accel_g", time: t, value: 1 }] } });

    const snap = feed.snapshot() as any;
    expect(snap.t).toBe("snapshot");
    expect(snap.metrics[0].time).toBeGreaterThanOrEqual(t - 120_000);
    expect(snap.metrics.at(-1).time).toBe(180_000);
    expect(snap.board.connected).toBe(true);
  });

  it("the snapshot has the full parameter list with the newest values, the state and the log", () => {
    const sent: any[] = [];
    const feed = new AdminFeed((m) => sent.push(m), { now: () => 5 });
    feed.setParams([{ name: "a.x", value: 1, min: 0, max: 2 }, { name: "a.y", value: 0, min: 0, max: 2 }]);
    feed.paramChanged("a.x", 2);
    feed.setState({ phase: "playing" });
    feed.event("start");
    expect(sent.map((m) => m.t)).toEqual(["params", "param", "event"]);
    expect(feed.snapshot()).toMatchObject({
      state: { phase: "playing" },
      params: [{ name: "a.x", value: 2 }, { name: "a.y", value: 0 }],
      events: [{ time: 5, message: "start" }],
    });
  });
});
