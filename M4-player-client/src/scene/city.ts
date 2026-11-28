import * as THREE from "three";
import { roadWidth, teamColor } from "./pose.ts";
import { Props } from "./props.ts";
import { texture } from "./textures.ts";
import { buildTown } from "./town.ts";
import type { CityPlan } from "./types.ts";

export const CITY_COLORS = {
  grass: "#7fae5b",
  asphalt: "#3a3f47",
  sidewalk: "#c9c4b8",
  lawn: "#8fbf62",
  yellow: "#f2c94c",
  white: "#f4f4f0",
  window: "#2c3a4a",
  windowLit: "#ffe2a0",
};

const CROSSWALK_M = 3;
const DASH_M = 3;
const GAP_M = 5;

export interface CityParts {
  group: THREE.Group;
  buildings: THREE.Mesh[];
  markings: THREE.InstancedMesh[];
  stores: THREE.Group[];
  props: Props;
  triangles: number;
}

export function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 7, 668265263) ^ Math.imul(c + 13, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function material(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0 });
}

type Box = { x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw?: number };

function boxes(list: Box[], mat: THREE.Material, colors?: string[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, Math.max(1, list.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  list.forEach((b, i) => {
    q.setFromAxisAngle(up, b.yaw ?? 0);
    m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.sx, b.sy, b.sz));
    mesh.setMatrixAt(i, m);
    if (colors) mesh.setColorAt(i, new THREE.Color(colors[i]));
  });
  mesh.count = list.length;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function gridLines(plan: CityPlan): { xs: number[]; zs: number[] } {
  const uniq = (v: number[]) => [...new Set(v)].sort((a, b) => a - b);
  return { xs: uniq(plan.nodes.map((n) => n.x)), zs: uniq(plan.nodes.map((n) => n.z)) };
}

function segmentsOf(plan: CityPlan) {
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  return plan.segments.map((s) => {
    const a = byId.get(s.a)!;
    const b = byId.get(s.b)!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    return { a, len, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len };
  });
}

function buildGround(plan: CityPlan, group: THREE.Group, half: number): void {
  const size = plan.world.size_m;
  const outer = size + 800;
  const grassMap = texture("grass")?.clone() ?? null;
  if (grassMap) grassMap.repeat.set(outer / 6, outer / 6);
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(outer, outer).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: "#ffffff", map: grassMap, roughness: 1 }),
  );
  grass.position.set(size / 2, -0.05, size / 2);
  grass.receiveShadow = true;
  grass.name = "grass";
  const pad = half + 4;
  const road = size + 2 * pad;
  const roadMap = texture("asphalt")?.clone() ?? null;
  if (roadMap) roadMap.repeat.set(road / 5, road / 5);
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(road, road).rotateX(-Math.PI / 2),
    roadMap ? new THREE.MeshStandardMaterial({ color: "#ffffff", map: roadMap, roughness: 0.95 }) : material(CITY_COLORS.asphalt),
  );
  asphalt.position.set(size / 2, 0, size / 2);
  asphalt.receiveShadow = true;
  asphalt.name = "asphalt";
  group.add(grass, asphalt);
}

function buildMarkings(plan: CityPlan, group: THREE.Group, half: number): THREE.InstancedMesh[] {
  const lane = plan.grid.lane_width_m;
  const yellow: Box[] = [];
  const white: Box[] = [];
  for (const s of segmentsOf(plan)) {
    const yaw = Math.atan2(-s.uz, s.ux);
    const at = (along: number, side: number) => ({
      x: s.a.x + s.ux * along - s.uz * side,
      z: s.a.z + s.uz * along + s.ux * side,
    });
    const from = half + CROSSWALK_M + 1;
    const to = s.len - from;
    for (const side of [-0.18, 0.18]) {
      const p = at((from + to) / 2, side);
      yellow.push({ ...p, y: 0.012, sx: to - from, sy: 0.02, sz: 0.14, yaw });
    }
    for (const side of [-lane, lane]) {
      for (let d = from; d + DASH_M <= to; d += DASH_M + GAP_M) {
        const p = at(d + DASH_M / 2, side);
        white.push({ ...p, y: 0.012, sx: DASH_M, sy: 0.02, sz: 0.14, yaw });
      }
    }
    for (const end of [half, s.len - half - CROSSWALK_M]) {
      for (let o = -half + 0.9; o < half - 0.6; o += 1.1) {
        const p = at(end + CROSSWALK_M / 2, o);
        white.push({ ...p, y: 0.012, sx: CROSSWALK_M, sy: 0.02, sz: 0.55, yaw });
      }
    }
  }
  const y = boxes(yellow, material(CITY_COLORS.yellow));
  y.name = "center-lines";
  const w = boxes(white, material(CITY_COLORS.white));
  w.name = "lane-marks";
  group.add(y, w);
  return [y, w];
}

function buildStore(store: CityPlan["stores"][number], size: number): THREE.Group {
  const g = new THREE.Group();
  g.name = `store-${store.team}`;
  g.position.set(store.pickup.x, 0, store.pickup.z);
  const color = teamColor(store.team);
  const r = store.pickup.radius_m;
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.28, roughness: 1 }),
  );
  pad.position.y = 0.22;
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.5, r, 48).rotateX(-Math.PI / 2), material(color));
  ring.position.y = 0.23;
  ring.name = "ring";
  g.add(pad, ring);

  const ox = store.pickup.x < size / 2 ? -1 : 1;
  const oz = store.pickup.z < size / 2 ? -1 : 1;
  const sign = new THREE.Group();
  sign.position.set(ox * 7, 0, oz * 7);
  sign.rotation.y = Math.atan2(-ox, -oz);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 8, 8), material("#e8e8e8"));
  pole.position.y = 4;
  const board = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.6, 0.4), material(color));
  board.position.y = 8.6;
  const parcel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 0.2), material("#c8955b"));
  parcel.position.set(0, 8.6, 0.3);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.1, 0.22), material("#e9d3a6"));
  tape.position.set(0, 8.6, 0.31);
  for (const m of [pole, board, parcel, tape]) m.castShadow = true;
  sign.add(pole, board, parcel, tape);
  g.add(sign);
  return g;
}

export const SIDEWALK_TOP = 0.18;
export const LAWN_TOP = 0.2;
const LAWN_INSET = 3;

export function groundHeight(plan: CityPlan): (x: number, z: number) => number {
  const { xs, zs } = gridLines(plan);
  const half = roadWidth(plan.grid) / 2;
  const cell = (v: number, lines: number[]) => {
    for (let i = 0; i + 1 < lines.length; i++) {
      const lo = lines[i] + half;
      const hi = lines[i + 1] - half;
      if (v > lo && v < hi) return Math.min(v - lo, hi - v);
    }
    return -1;
  };
  return (x, z) => {
    const dx = cell(x, xs);
    const dz = cell(z, zs);
    if (dx < 0 || dz < 0) return 0;
    return Math.min(dx, dz) > LAWN_INSET ? LAWN_TOP : SIDEWALK_TOP;
  };
}

export function buildCity(plan: CityPlan): CityParts {
  const group = new THREE.Group();
  group.name = "city";
  const half = roadWidth(plan.grid) / 2;
  buildGround(plan, group, half);
  const markings = buildMarkings(plan, group, half);
  const town = buildTown(plan);
  const meshes = town.meshes();
  group.add(...meshes);
  const props = new Props(plan, town.trees, town.benches);
  group.add(props.group);
  const stores = plan.stores.map((st) => buildStore(st, plan.world.size_m));
  group.add(...stores);
  return { group, buildings: meshes, markings, stores, props, triangles: town.triangles };
}
