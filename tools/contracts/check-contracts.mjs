// Checks the shared files in contracts/. Run: node check-contracts.mjs
//
// - city_plan.json follows the ID formulas and the grid geometry
// - every protocol vector gives the same bytes when encoded, and decodes back to the same message
// - the largest board state fits in one Wi-Fi packet (< 1400 bytes)

import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { pack, unpack } from "./protocol.mjs";

const read = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../contracts/${f}`, import.meta.url)), "utf8"));
const errors = [];
const check = (cond, msg) => {
  if (!cond) errors.push(msg);
};

// --- city plan -------------------------------------------------------------
const plan = read("city_plan.json");
const L = plan.grid.lines;
const P = plan.grid.pitch_m;
check(plan.nodes.length === L * L, "node count");
check(plan.segments.length === 2 * L * (L - 1), "segment count");
const nodes = new Map(plan.nodes.map((n) => [n.id, n]));
for (const n of plan.nodes) {
  const [r, c] = n.name.split("_").slice(1).map(Number);
  check(n.id === 6 * r + c, `node id ${n.name}`);
  check(n.x === c * P && n.z === r * P, `node position ${n.name}`);
}
for (const s of plan.segments) {
  const [r, c] = s.name.split("_").slice(1).map(Number);
  const want = s.name[0] === "h" ? 5 * r + c : 30 + 6 * r + c;
  check(s.id === want, `segment id ${s.name}`);
  const a = nodes.get(s.a);
  const b = nodes.get(s.b);
  check(a && b && Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === s.length_m, `segment length ${s.name}`);
}
const segIds = new Set(plan.segments.map((s) => s.id));
for (const d of plan.delivery_candidates) {
  check(segIds.has(d.segment) && d.t >= 0 && d.t <= 1, `delivery candidate ${d.id}`);
}
check(JSON.stringify(plan.stores.map((s) => s.team).sort()) === "[0,1,2,3]", "stores");

// --- protocol vectors ------------------------------------------------------
const vec = read("board_protocol_vectors.json");
for (const v of vec.vectors) {
  const raw = Buffer.from(v.msgpack_hex, "hex");
  check(pack(v.json).equals(raw), `vector ${v.name}: encode gives other bytes`);
  check(raw.length === v.bytes, `vector ${v.name}: byte count`);
  // float32 keeps about 7 digits, so numbers are compared with 7 digits.
  const round = (obj) => JSON.parse(JSON.stringify(obj, (_k, x) => (typeof x === "number" ? Number(x.toPrecision(7)) : x)));
  let back;
  try {
    back = round(unpack(raw));
  } catch (e) {
    check(false, `vector ${v.name}: bytes do not decode (${e.message})`);
    continue;
  }
  check(isDeepStrictEqual(back, round(v.json)), `vector ${v.name}: decode gives another message`);
}

const worst = { t: "S", v: 1, sid: 4294967295, seq: 4294967295, ts: 4294967295, d: {
  ph: 2, tl: 300,
  p: Array.from({ length: 8 }, (_, i) => [i, i >> 1, i % 2, 31, 0.123456, 0.654321, 359.9, 19.99]),
  dp: Array.from({ length: 8 }, (_, i) => [i, 0.123456, 0.654321, 1]),
  ob: Array.from({ length: 60 }, (_, s) => [s, 3, 2]),
  eq: [1, 0.5, 0.5, 10, 65535] } };
const size = pack(worst).length;
check(size < 1400, `largest board state is ${size} bytes (limit 1400)`);

if (errors.length) {
  console.log("Contract check FAILED:");
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log(
  `Contracts OK: ${plan.nodes.length} nodes, ${plan.segments.length} segments, ` +
    `${vec.vectors.length} protocol vectors, largest board state ${size} bytes`,
);
