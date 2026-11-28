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
// depot: the team's warehouse in the store corner, as printed for the board (tools/print/gen-city.py,
// a quarter of the corner block). It is only a picture: not solid, the pickup area stays drivable.
const DEPOT_NEAR_M = [10, 8.9]; // from the city corner: across, along the ridge (it reaches 1.1 m nearer the road)
const DEPOT_FAR_M = 50;
const DEPOT_HEIGHT_M = 25.7;
function depot(cornerX, cornerZ) {
  const sx = cornerX === 0 ? 1 : -1;
  const sz = cornerZ === 0 ? 1 : -1;
  const xs = [cornerX + sx * DEPOT_NEAR_M[0], cornerX + sx * DEPOT_FAR_M].sort((p, q) => p - q);
  const zs = [cornerZ + sz * DEPOT_NEAR_M[1], cornerZ + sz * DEPOT_FAR_M].sort((p, q) => p - q);
  return {
    footprint: [[xs[0], zs[0]], [xs[1], zs[0]], [xs[1], zs[1]], [xs[0], zs[1]]],
    height_m: DEPOT_HEIGHT_M,
    roof: "gable, ridge north-south",
    solid: false,
  };
}
const stores = [
  { team: 0, color: "blue", corner: "NW", node: 0, pickup: { x: 18, z: 18, radius_m: 10 }, depot: depot(0, 0) },
  { team: 1, color: "green", corner: "NE", node: 5, pickup: { x: 482, z: 18, radius_m: 10 }, depot: depot(SIZE_M, 0) },
  { team: 2, color: "purple", corner: "SW", node: 30, pickup: { x: 18, z: 482, radius_m: 10 }, depot: depot(0, SIZE_M) },
  { team: 3, color: "yellow", corner: "SE", node: 35, pickup: { x: 482, z: 482, radius_m: 10 }, depot: depot(SIZE_M, SIZE_M) },
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
const STORE_CLEAR_M = 50; // a quarter of the corner block, where the depot stands

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

// What stands on each block and its highest point, as in the printed board buildings
// (tools/print/gen-city.py, M6-5): detached houses in the outer ring, apartments inside,
// one tower in the centre. 1 m = 1.12 mm on the board. tools/print/check-buildings.py
// checks that every printed block is exactly this high.
// Index = block id (5r + c).
const KIND = [
  "houses", "houses", "apartments", "houses", "houses",
  "houses", "apartments", "apartments", "apartments", "houses",
  "apartments", "apartments", "tower", "apartments", "apartments",
  "houses", "apartments", "apartments", "apartments", "houses",
  "houses", "houses", "apartments", "houses", "houses",
];
const HEIGHT_M = [
  12.8, 12.8, 24.8, 12.8, 12.8,
  12.8, 25.4, 24.4, 25.3, 12.8,
  25.8, 24.4, 53.6, 26.1, 24.8,
  12.8, 25.6, 22.8, 24.8, 12.8,
  12.8, 12.8, 23.1, 12.8, 12.8,
];

const buildings = [];
for (let r = 0; r < LINES - 1; r++) {
  for (let c = 0; c < LINES - 1; c++) {
    const id = 5 * r + c;
    buildings.push({ id, block: `b_${r}_${c}`, kind: KIND[id], footprint: blockFootprint(r, c), height_m: HEIGHT_M[id] });
  }
}

const plan = {
  version: "0.3.0",
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
