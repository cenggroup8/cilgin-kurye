import { decode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";
import { smallAdminState, StateBroadcaster, type BroadcastLinks } from "../src/broadcast/stateBroadcaster.js";
import { FakeM1 } from "./fakes/fakeM1.js";

function links(players: number[], admin: number | null) {
  const sent: Array<{ connId: number; bytes: Uint8Array }> = [];
  const l: BroadcastLinks = {
    players: () => players,
    admin: () => admin,
    sendBytes: (connId, bytes) => sent.push({ connId, bytes }),
  };
  return { l, sent };
}

describe("M2-3 state broadcaster", () => {
  it("encodes the state once and gives every phone the same bytes", () => {
    const { l, sent } = links([1, 2, 3, 4, 5, 6, 7, 8], null);
    const b = new StateBroadcaster(l);
    const m1 = new FakeM1();
    b.publish(m1.frame());
    expect(sent).toHaveLength(8);
    expect(new Set(sent.map((s) => s.bytes)).size).toBe(1);
    const msg = decode(sent[0]!.bytes) as { t: string; seq: number; s: { tick: number } };
    expect(msg).toMatchObject({ t: "state", seq: 1, s: { tick: 1 } });
    expect(b.stats().stateBytes).toBe(sent[0]!.bytes.byteLength);
  });

  it("sends a smaller state to the admin 10 times per second", () => {
    const { l, sent } = links([1], 99);
    const b = new StateBroadcaster(l, { tickHz: 30, adminHz: 10 });
    const m1 = new FakeM1();
    for (let i = 0; i < 30; i++) b.publish(m1.frame());
    const admin = sent.filter((s) => s.connId === 99);
    expect(admin).toHaveLength(10);
    const state = (decode(admin[0]!.bytes) as { t: string; state: { players: object[] } }).state;
    expect(state.players[0]).not.toHaveProperty("control");
    expect(state.players[0]).toHaveProperty("pose");
    expect(b.stats().adminStateBytes).toBeLessThan(b.stats().stateBytes);
  });

  it("gives every board state to the board link, which keeps the newest", () => {
    const { l } = links([], null);
    const got: unknown[] = [];
    const b = new StateBroadcaster(l, { board: { setState: (s) => got.push(s) } });
    const m1 = new FakeM1();
    for (let i = 0; i < 5; i++) b.publish(m1.frame());
    expect(got).toHaveLength(5);
    expect(got[4]).toMatchObject({ ph: "playing" });
  });

  it("counts the bytes of the last full second", () => {
    let t = 0;
    const { l } = links([1, 2], null);
    const b = new StateBroadcaster(l, { now: () => t });
    const m1 = new FakeM1();
    let total = 0;
    for (let i = 0; i < 30; i++) {
      b.publish(m1.frame());
      total += b.stats().stateBytes * 2;
      t += 1000 / 30;
    }
    t = 1000;
    expect(b.stats().bytesPerSecond).toBe(total);
    expect(b.stats().bytesOut).toBe(total);
    t = 5000;
    expect(b.stats().bytesPerSecond).toBe(0);
  });

  it("leaves a state that has no players as it is", () => {
    expect(smallAdminState({ phase: "lobby" })).toEqual({ phase: "lobby" });
    expect(smallAdminState(null)).toBe(null);
  });
});
