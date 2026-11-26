// Generates contracts/board_protocol_vectors.json (board protocol, version 1).
// Run: node gen-protocol-vectors.mjs
//
// Each vector holds one message as JSON and its exact MessagePack bytes in hex.
// The server (M2), the ESP32 program (M6) and the PC tools must encode and
// decode every vector in the same way. Field meanings: contracts/board_protocol.md.
//
// Keep every float value non-whole (0.6, not 1.0): JSON cannot tell 1.0 from 1,
// so a whole float would not give the same bytes in every language.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ENCODING, pack } from "./protocol.mjs";

/** Session number of the server in the examples (board_protocol.md section 6). */
const SID = 1402754;

/** The board names the city plan it has by its version, so the vectors use the current one. */
const PLAN = JSON.parse(readFileSync(fileURLToPath(new URL("../../contracts/city_plan.json", import.meta.url)), "utf8")).version;

const VECTORS = {
  // server -> board
  state: { t: "S", v: 1, sid: SID, seq: 52031, ts: 60800, d: {
    ph: 2, tl: 239,
    p: [[2, 1, 0, 13, 0.4248, 0.1962, 88, 11.2],
        [5, 3, 1, 17, 0.82, 0.6004, 180, 7.9]],
    dp: [[2, 0.7, 0.304, 0]],
    ob: [[12, 2, 0], [41, 3, 1], [20, 1, 0]],
    eq: [1, 0.52, 0.48, 7, 840] } },
  config: { t: "C", v: 1, sid: SID, seq: 4, ts: 0, ack: true, d: {
    plan: PLAN, bright: 0.6, max_ma: 4000,
    tones: [[80, 160, 255], [0, 60, 220], [90, 255, 90], [0, 150, 40],
            [200, 110, 255], [110, 0, 200], [255, 230, 80], [210, 140, 0]],
    anim: { tail: 2, dp_blink_hz: 1.5 } } },
  vibrate: { t: "V", v: 1, sid: SID, seq: 9, ts: 61200, ack: true,
             d: { mask: 5, duty: 0.8, ms: 1500, ramp_ms: 200 } },
  ping: { t: "P", v: 1, sid: SID, seq: 620, ts: 60790, d: {} },
  ack: { t: "A", v: 1, sid: SID, seq: 77, ts: 123470, d: { of: "Q" } },
  // board -> server
  hello: { t: "H", v: 1, seq: 1, ts: 1200,
           d: { fw: "0.4.1", plan: PLAN, board: "board-01" } },
  quake: { t: "Q", v: 1, seq: 77, ts: 123456, ack: true,
           d: { id: 12, src: "hit", peak_g: 3.8, mag: 6.1, u: 0.31, v: 0.72, zone: 6, conf: 0.7 } },
  sensor: { t: "N", v: 1, seq: 9001, ts: 123400,
            d: { hz: 100, a: [0.01, 0.02, 0.01, 0.85, 2.9, 3.8, 1.2, 0.4, 0.1, 0.03] } },
  status: { t: "T", v: 1, seq: 310, ts: 310020,
            d: { fw: "0.4.1", plan: PLAN, last_seq: 52031, fps: 60,
                 rssi: -52, ma_est: 1850, heap: 182000, err: [] } },
  pong: { t: "O", v: 1, seq: 620, ts: 310050,
          d: { ping_ts: 60790, state_seq: 52031, state_age_ms: 9 } },
};

const out = {
  protocol_version: 1,
  encoding: ENCODING,
  vectors: Object.entries(VECTORS).map(([name, json]) => {
    const bytes = pack(json);
    return { name, json, msgpack_hex: bytes.toString("hex"), bytes: bytes.length };
  }),
};

const path = fileURLToPath(new URL("../../contracts/board_protocol_vectors.json", import.meta.url));
writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
for (const v of out.vectors) console.log(`${v.name.padEnd(8)} ${String(v.bytes).padStart(4)} bytes`);
console.log(`wrote ${path}`);
