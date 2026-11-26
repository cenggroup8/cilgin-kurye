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

// Buildings (#22, K8/K9): one box per block until the 3D model is ready.
// Block b_r_c lies between intersection rows r, r+1 and columns c, c+1; id = 5r + c (0-24).
// A building keeps SETBACK_M from the road centre line: 2 lanes of 3.5 m and a 3 m sidewalk.
// In a corner block the store corner stays free (STORE_CLEAR_M from the city corner).
// Footprint corners are clockwise seen from above (x east, z south).
const LANES = 2;
const LANE_W = 3.5;
const SETBACK_M = LANES * LANE_W + 3; // 10
const STORE_CLEAR_M = 30;

function blockFootprint(r, c) {
  const x0 = c * PITCH_M + SETBACK_M;
  const x1 = (c + 1) * PITCH_M - SETBACK_M;
  const z0 = r * PITCH_M + SETBACK_M;
  const z1 = (r + 1) * PITCH_M - SETBACK_M;
  const last = LINES - 2;
  const corner = (r === 0 || r === last) && (c === 0 || c === last); // every corner block has a store
  if (!corner) return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  // Cut the store corner out: the store is at the city corner of this block.
  const W = c === 0; // store on the west side
  const N = r === 0; // store on the north side
  const cx = W ? c * PITCH_M + STORE_CLEAR_M : (c + 1) * PITCH_M - STORE_CLEAR_M;
  const cz = N ? r * PITCH_M + STORE_CLEAR_M : (r + 1) * PITCH_M - STORE_CLEAR_M;
  if (N && W) return [[cx, z0], [x1, z0], [x1, z1], [x0, z1], [x0, cz], [cx, cz]];
  if (N && !W) return [[x0, z0], [cx, z0], [cx, cz], [x1, cz], [x1, z1], [x0, z1]];
  if (!N && !W) return [[x0, z0], [x1, z0], [x1, cz], [cx, cz], [cx, z1], [x0, z1]];
  return [[x0, z0], [x1, z0], [x1, z1], [cx, z1], [cx, cz], [x0, cz]];
}

const buildings = [];
for (let r = 0; r < LINES - 1; r++) {
  for (let c = 0; c < LINES - 1; c++) {
    // Placeholder heights, 12-36 m, so the city does not look flat. Fixed, no random numbers.
    const height_m = 12 + ((7 * r + 3 * c) % 5) * 6;
    buildings.push({ id: 5 * r + c, block: `b_${r}_${c}`, footprint: blockFootprint(r, c), height_m });
  }
}

const plan = {
  version: "0.2.0",
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
  buildings,
};

const out = fileURLToPath(new URL("../../contracts/city_plan.json", import.meta.url));
writeFileSync(out, JSON.stringify(plan, null, 2) + "\n");
console.log(`wrote ${out} (${nodes.length} nodes, ${segments.length} segments, ${candidates.length} candidates, ${buildings.length} buildings)`);
