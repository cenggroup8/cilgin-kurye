// Done criterion of #56: both emulators encode and decode all example messages
// of contracts/board_protocol_vectors.json correctly.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCityPlan } from "../src/common/cityPlan.js";
import { MessageFactory, decode, encode, type BoardMsg } from "../src/common/protocol.js";
import { defaultConfig } from "../src/server/serverEmulator.js";
import { Scenario } from "../src/server/scenario.js";

interface Vector {
  name: string;
  json: BoardMsg;
  msgpack_hex: string;
}

const VECTORS: Vector[] = JSON.parse(readFileSync(new URL("../../../contracts/board_protocol_vectors.json", import.meta.url), "utf8")).vectors;
const byName = (n: string) => VECTORS.find((v) => v.name === n)!;
const hex = (m: BoardMsg) => Buffer.from(encode(m)).toString("hex");
/** float32 keeps about 7 digits. */
const round = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "number" ? Number(v.toPrecision(7)) : v)));

/** Builds a message the way an emulator does, with the seq and ts of the vector. */
function build(side: "server" | "board", v: BoardMsg): BoardMsg {
  const f = new MessageFactory(side === "server" ? v.sid : undefined, () => 0);
  return f.raw(v.t, v.seq, v.d, v.ack === true, v.ts);
}

describe("contract vectors", () => {
  it("has all ten", () => {
    expect(VECTORS.map((v) => v.name).sort()).toEqual(["ack", "config", "hello", "ping", "pong", "quake", "sensor", "state", "status", "vibrate"]);
  });

  for (const v of VECTORS) {
    it(`${v.name}: both emulators decode it`, () => {
      const r = decode(Buffer.from(v.msgpack_hex, "hex"));
      expect(r.ok).toBe(true);
      if (r.ok) expect(round(r.msg)).toEqual(round(v.json));
    });
  }

  it("server emulator encodes S, C, V, P and A byte for byte", () => {
    for (const n of ["state", "config", "vibrate", "ping", "ack"]) {
      const v = byName(n);
      expect(hex(build("server", v.json)), n).toBe(v.msgpack_hex);
    }
  });

  it("board emulator encodes H, Q, N, T and O byte for byte", () => {
    for (const n of ["hello", "quake", "sensor", "status", "pong"]) {
      const v = byName(n);
      expect(hex(build("board", v.json)), n).toBe(v.msgpack_hex);
    }
  });

  it("the default config of the server emulator is the config of the vectors", () => {
    const v = byName("config").json;
    const plan = { ...loadCityPlan(), version: (v.d as { plan: string }).plan };
    const m = new MessageFactory(v.sid, () => 0).raw("C", v.seq, defaultConfig(plan), true, v.ts);
    expect(hex(m)).toBe(byName("config").msgpack_hex);
  });

  it("board states of the scenario have the fields in the order of the vectors", () => {
    const s = new Scenario(loadCityPlan()).boardState();
    expect(Object.keys(s)).toEqual(Object.keys(byName("state").json.d));
  });
});
