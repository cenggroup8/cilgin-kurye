// M4-3 (#45): message checks, player key and control numbers, without a network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encode } from "@msgpack/msgpack";
import { checkServerMessage, decodeServerMessage } from "../../src/net/decode.ts";
import { SeqOffset, memoryStore, playerKey, type KeyValueStore } from "../../src/net/storage.ts";

describe("server messages", () => {
  it("takes every message of the contract", () => {
    assert.deepEqual(checkServerMessage({ t: "welcome", player: 3, returning: true }), { t: "welcome", player: 3, returning: true });
    assert.deepEqual(checkServerMessage({ t: "joined", player: 3, team: 1, color: "green" }), { t: "joined", player: 3, team: 1, color: "green" });
    assert.deepEqual(checkServerMessage({ t: "error", reason: "out_of_range", ref: "control" }), { t: "error", reason: "out_of_range", ref: "control" });
    assert.deepEqual(checkServerMessage({ t: "state", seq: 9, s: { phase: "lobby" } }), { t: "state", seq: 9, s: { phase: "lobby" } });
    assert.deepEqual(checkServerMessage({ t: "ping", id: 4, st: 1.5 }), { t: "ping", id: 4, st: 1.5 });
    assert.deepEqual(checkServerMessage({ t: "net", fps_limit: 0 }), { t: "net", fps_limit: 0 });
  });

  it("drops what does not fit", () => {
    for (const bad of [null, 5, [], { t: 1 }, { t: "welcome", player: 8, returning: true }, { t: "joined", player: 0, team: 4, color: "x" },
      { t: "state", seq: 1.5, s: {} }, { t: "state", seq: 1, s: [] }, { t: "ping", id: 0, st: 1 }, { t: "net", fps_limit: 121 }, { t: "error" }]) {
      assert.equal(checkServerMessage(bad), undefined, JSON.stringify(bad));
    }
  });

  it("decodes MessagePack and the readable JSON form, never throws", () => {
    const ab = encode({ t: "ping", id: 1, st: 2 });
    assert.deepEqual(decodeServerMessage(ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength)), { t: "ping", id: 1, st: 2 });
    assert.deepEqual(decodeServerMessage('{"t":"net","fps_limit":30}'), { t: "net", fps_limit: 30 });
    assert.equal(decodeServerMessage(Uint8Array.from([0xc1])), undefined);
    assert.equal(decodeServerMessage("{"), undefined);
    assert.equal(decodeServerMessage(42), undefined);
  });
});

describe("player key", () => {
  it("is made once and kept", () => {
    const store = memoryStore();
    const k = playerKey(store);
    assert.match(k, /^[0-9a-f]{32}$/);
    assert.equal(playerKey(store), k);
  });

  it("works when the browser storage throws (private mode)", () => {
    const broken: KeyValueStore = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    assert.match(playerKey(broken), /^[0-9a-f]{32}$/);
    const seq = new SeqOffset(broken, "k");
    assert.equal(seq.toWire(5), 5);
  });
});

describe("control numbers across a reload", () => {
  it("a new page starts above every number the old page sent", () => {
    const store = memoryStore();
    const first = new SeqOffset(store, "k");
    let last = 0;
    for (let n = 1; n <= 75; n++) last = first.toWire(n);
    assert.equal(last, 75);
    const second = new SeqOffset(store, "k");
    assert.ok(second.toWire(1) > last);
    assert.equal(second.toLocal(second.toWire(7)), 7);
    // A number from before the reload is not one of this page.
    assert.ok(second.toLocal(last) <= 0);
  });

  it("keys do not share numbers", () => {
    const store = memoryStore();
    new SeqOffset(store, "a").toWire(100);
    assert.equal(new SeqOffset(store, "b").toWire(1), 1);
  });
});
