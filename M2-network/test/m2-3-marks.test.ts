// `snapshot.marks` (contracts/messages.md, #101): the commands accepted in the history time, at
// server time, so the graphs of the admin page draw their change marks again after a reload.
import { describe, expect, it } from "vitest";
import { AdminFeed } from "../src/broadcast/adminFeed.js";
import { attachBroadcast } from "../src/broadcast/broadcastHub.js";

describe("M2-3 change marks in the snapshot", () => {
  it("keeps the accepted commands of the last two minutes, at server time", () => {
    let t = 1_000_000;
    const feed = new AdminFeed(() => {}, { now: () => t, historyMs: 120_000 });
    expect((feed.snapshot() as any).marks).toEqual([]);
    feed.addMark("physics.npc_count");
    t += 60_000;
    feed.addMark("start");
    expect((feed.snapshot() as any).marks).toEqual([
      { time: 1_000_000, name: "physics.npc_count" },
      { time: 1_060_000, name: "start" },
    ]);
    t += 61_000; // the first one is now older than two minutes
    expect((feed.snapshot() as any).marks).toEqual([{ time: 1_060_000, name: "start" }]);
  });

  it("names a param_set mark after its parameter, other commands after the command", () => {
    let t = 5_000;
    const snaps: any[] = [];
    const server = {
      registry: { playerConns: () => [], adminConn: 1 } as any,
      send: (_c: number, msg: any) => snaps.push(msg),
      sendRaw: () => {},
    };
    const hub = attachBroadcast({ server, timers: false, now: () => t });
    hub.commandAccepted("param_set", { name: "quake.mag", value: 6 });
    t += 10;
    hub.commandAccepted("quake", { mag: 6, zone: -1 });
    hub.commandAccepted("param_set"); // no args: the command's name
    hub.onMessage({ role: "admin", connId: 1 } as any, { t: "snapshot_get" });
    const snap = snaps.find((m) => m.t === "snapshot");
    expect(snap.marks).toEqual([
      { time: 5_000, name: "quake.mag" },
      { time: 5_010, name: "quake" },
      { time: 5_010, name: "param_set" },
    ]);
  });
});
