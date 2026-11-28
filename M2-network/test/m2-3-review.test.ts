// Review notes of #84 (Umutcan): a slow phone is skipped, a finished earthquake ends.
import { describe, expect, it } from "vitest";
import { AdminFeed } from "../src/broadcast/adminFeed.js";
import { StateBroadcaster } from "../src/broadcast/stateBroadcaster.js";
import { FakeM1 } from "./fakes/fakeM1.js";

describe("M2-3 review of #84", () => {
  it("a phone whose link is too far behind skips the state of this tick; the others get it", () => {
    const backlog = new Map([[1, 0], [2, 200 * 1024]]);
    const sent: number[] = [];
    const b = new StateBroadcaster(
      { players: () => [1, 2], admin: () => null, sendBytes: (c) => sent.push(c), backlog: (c) => backlog.get(c) ?? 0 },
      { maxBacklogBytes: 64 * 1024 },
    );
    const m1 = new FakeM1();
    b.publish(m1.frame());
    b.publish(m1.frame());
    expect(sent).toEqual([1, 1]);
    expect(b.stats().skippedSlow).toBe(2);
    backlog.set(2, 1000); // the phone caught up
    b.publish(m1.frame());
    expect(sent).toEqual([1, 1, 1, 2]);
  });

  it("without a backlog function nobody is skipped", () => {
    const sent: number[] = [];
    const b = new StateBroadcaster({ players: () => [1, 2], admin: () => null, sendBytes: (c) => sent.push(c) });
    b.publish(new FakeM1().frame());
    expect(sent).toEqual([1, 2]);
    expect(b.stats().skippedSlow).toBe(0);
  });

  it("an earthquake ends after the hold time, or at once with quake: null", () => {
    let t = 0;
    const sent: any[] = [];
    const feed = new AdminFeed((m) => sent.push(m), { now: () => t, quakeHoldMs: 20_000 });
    feed.addBoard({ connected: true, quake: { mag: 6, zone: 4 } });
    expect(sent.at(-1).board.quake).toEqual({ mag: 6, zone: 4 });
    t = 15_000;
    expect((feed.snapshot() as any).board.quake).toEqual({ mag: 6, zone: 4 });
    t = 20_001;
    expect((feed.snapshot() as any).board).toEqual({ connected: true, samples: [] });
    feed.addBoard({ samples: [] });
    expect(sent.at(-1).board.quake).toBeUndefined();

    feed.addBoard({ quake: { mag: 3, zone: 1 } });
    feed.addBoard({ quake: null });
    expect((feed.snapshot() as any).board.quake).toBeUndefined();
  });
});
