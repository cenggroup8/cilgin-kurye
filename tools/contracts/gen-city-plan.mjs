// Generates contracts/city_plan.json from the fixed grid rules.
// Run: node gen-city-plan.mjs
//
// ID rules (see contracts/README.md):
//   node    n_r_c -> id = 6r + c        (0-35)
//   segment h_r_c -> id = 5r + c        (0-29, east-west, n_r_c -> n_r_(c+1))
//   segment v_r_c -> id = 30 + 6r + c   (30-59, north-south, n_r_c -> n_(r+1)_c)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LINES = 6;
const PITCH_M = 100;
const SIZE_M = PITCH_M * (LINES - 1); // 500

const nodes = [];
for (let r = 0; r < LINES; r++) {
  for (let c = 0; c < LINES; c++) {
    nodes.push({ id: 6 * r + c, name: `n_${r}_${c}`, x: c * PITCH_M, z: r * PITCH_M });
  }
}

const segments = [];
for (let r = 0; r < LINES; r++) {
  for (let c = 0; c < LINES - 1; c++) {
    segments.push({ id: 5 * r + c, name: `h_${r}_${c}`, a: 6 * r + c, b: 6 * r + c + 1, dir: "EW", length_m: PITCH_M });
  }
}
for (let r = 0; r < LINES - 1; r++) {
  for (let c = 0; c < LINES; c++) {
    segments.push({ id: 30 + 6 * r + c, name: `v_${r}_${c}`, a: 6 * r + c, b: 6 * (r + 1) + c, dir: "NS", length_m: PITCH_M });
  }
}
segments.sort((p, q) => p.id - q.id);

// Stores sit inside the four corner blocks.
const stores = [
  { team: 0, color: "blue", corner: "NW", node: 0, pickup: { x: 18, z: 18, radius_m: 10 } },
  { team: 1, color: "green", corner: "NE", node: 5, pickup: { x: 482, z: 18, radius_m: 10 } },
  { team: 2, color: "purple", corner: "SW", node: 30, pickup: { x: 18, z: 482, radius_m: 10 } },
  { team: 3, color: "yellow", corner: "SE", node: 35, pickup: { x: 482, z: 482, radius_m: 10 } },
];

// Draft: one delivery candidate at the middle of every segment. Side: E/W for NS roads, N/S for EW roads.
const candidates = segments.map((s) => ({
  id: s.id,
  segment: s.id,
  t: 0.5,
  side: s.dir === "EW" ? (s.id % 2 ? "S" : "N") : s.id % 2 ? "E" : "W",
}));

const plan = {
  version: "0.1.0",
  status: "draft - frozen when all module proposals are approved",
  world: {
    size_m: SIZE_M,
    origin: "n_0_0",
    axes: "x east, z south, y up; heading degrees clockwise from north",
    board_uv: "u = x / size_m, v = z / size_m",
  },
  grid: { lines: LINES, pitch_m: PITCH_M, lanes_per_direction: 2, lane_width_m: 3.5 },
  nodes,
  segments,
  stores,
  delivery_candidates: candidates,
};

const out = fileURLToPath(new URL("../../contracts/city_plan.json", import.meta.url));
writeFileSync(out, JSON.stringify(plan, null, 2) + "\n");
console.log(`wrote ${out} (${nodes.length} nodes, ${segments.length} segments, ${candidates.length} candidates)`);
