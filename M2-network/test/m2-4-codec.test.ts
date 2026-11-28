import { readFileSync } from "node:fs";
import { encode as mpEncode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";
import { type BoardMsg, Deframer, MAX_FRAME, decode, encode, frame } from "../src/board/codec.js";
import { SeqTracker } from "../src/board/seq.js";

interface Vector {
  name: string;
  json: BoardMsg;
  msgpack_hex: string;
  bytes: number;
}

const VECTORS: Vector[] = JSON.parse(
  readFileSync(new URL("../../contracts/board_protocol_vectors.json", import.meta.url), "utf8"),
).vectors;

/** float32 keeps about 7 digits. */
const round = (x: unknown): unknown =>
  JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "number" ? Number(v.toPrecision(7)) : v)));

describe("board codec with the contract vectors", () => {
  it("has all ten vectors", () => {
    expect(VECTORS.map((v) => v.name).sort()).toEqual(
      ["ack", "config", "hello", "ping", "pong", "quake", "sensor", "state", "status", "vibrate"],
    );
  });

  for (const v of VECTORS) {
    it(`${v.name}: encode gives the exact bytes`, () => {
      expect(Buffer.from(encode(v.json)).toString("hex")).toBe(v.msgpack_hex);
    });
    it(`${v.name}: decode gives the same message`, () => {
      const r = decode(Buffer.from(v.msgpack_hex, "hex"));
      expect(r.ok).toBe(true);
      if (r.ok) expect(round(r.msg)).toEqual(round(v.json));
    });
  }

  it("server messages carry the session number, board messages do not", () => {
    for (const v of VECTORS) {
      const fromServer = ["S", "C", "V", "P", "A"].includes(v.json.t);
      expect(v.json.sid !== undefined).toBe(fromServer);
    }
  });
});

describe("bad messages are dropped, never thrown", () => {
  const good = { t: "S", v: 1, seq: 1, ts: 0, d: {} };
  const cases: [string, Uint8Array, string][] = [
    ["random bytes", Uint8Array.from([0xc1, 0xff, 0x00]), "not_msgpack"],
    ["empty", new Uint8Array(0), "not_msgpack"],
    ["a list", mpEncode([1, 2, 3]), "not_a_map"],
    ["unknown type", mpEncode({ ...good, t: "X" }), "bad_type"],
    ["other version", mpEncode({ ...good, v: 2 }), "bad_version"],
    ["no seq", mpEncode({ t: "S", v: 1, ts: 0, d: {} }), "bad_field"],
    ["negative seq", mpEncode({ ...good, seq: -1 }), "bad_field"],
    ["text ts", mpEncode({ ...good, ts: "now" }), "bad_field"],
    ["d is a list", mpEncode({ ...good, d: [] }), "bad_field"],
    ["bad sid", mpEncode({ ...good, sid: 1.5 }), "bad_field"],
    ["ack false", mpEncode({ ...good, ack: false }), "bad_field"],
  ];
  for (const [name, bytes, error] of cases) {
    it(name, () => expect(decode(bytes)).toEqual({ ok: false, error }));
  }

  it("a whole number where a float is expected is accepted", () => {
    const r = decode(mpEncode({ t: "V", v: 1, seq: 1, ts: 0, ack: true, d: { mask: 1, duty: 1, ms: 100, ramp_ms: 0 } }));
    expect(r.ok).toBe(true);
  });

  it("fields in another order are accepted", () => {
    const r = decode(mpEncode({ d: {}, ts: 5, seq: 3, v: 1, t: "P", sid: 9 }));
    expect(r).toMatchObject({ ok: true, msg: { t: "P", seq: 3, sid: 9 } });
  });
});

describe("TCP framing", () => {
  const msgs = VECTORS.map((v) => encode(v.json));
  const stream = Buffer.concat(msgs.map((m) => frame(m)));

  it("puts a 2 byte length in front, high byte first", () => {
    const f = frame(Uint8Array.from([7, 8, 9]));
    expect([...f]).toEqual([0, 3, 7, 8, 9]);
  });

  it("finds every message, whatever the chunk size", () => {
    for (const size of [1, 2, 3, 7, 64, stream.length]) {
      const d = new Deframer();
      const got: Buffer[] = [];
      for (let i = 0; i < stream.length; i += size) got.push(...d.push(stream.subarray(i, i + size)));
      expect(got.map((b) => b.toString("hex"))).toEqual(msgs.map((m) => Buffer.from(m).toString("hex")));
      expect(d.pending).toBe(0);
    }
  });

  it("refuses a message that is too long", () => {
    expect(() => frame(new Uint8Array(MAX_FRAME + 1))).toThrow();
  });
});

describe("order numbers", () => {
  it("drops late and repeated UDP packets, per type", () => {
    const s = new SeqTracker();
    expect([5, 6, 6, 4, 8].map((n) => s.accept("N", n))).toEqual([true, true, false, false, true]);
    expect(s.accept("O", 1)).toBe(true); // other type, own count
  });

  it("gaps give the real loss", () => {
    const s = new SeqTracker();
    for (let n = 1; n <= 100; n++) if (n % 4 !== 2) s.accept("N", n); // every fourth one lost
    expect(s.lossPct()).toBe(25);
    s.reset();
    expect(s.lossPct()).toBe(0);
    expect(s.accept("N", 1)).toBe(true); // a new Hello starts again
  });
});
