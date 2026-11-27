import * as THREE from "three";
import { roadWidth, teamColor } from "./pose.ts";
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

const WARM = ["#e9d8b9", "#f2b880", "#d98c6a", "#c4d7a4", "#9cc5b4", "#f1dd8c", "#d7c6e3", "#e6b8b0"];
const GLASS = ["#8fb2cc", "#a7bfd1", "#7d9fb8", "#b6c7d6"];

const FLOOR_M = 3.5;
const WINDOW_STEP_M = 4;
const CROSSWALK_M = 3;
const DASH_M = 3;
const GAP_M = 5;

export interface CityParts {
  group: THREE.Group;
  buildings: THREE.Mesh[];
  windows: THREE.InstancedMesh;
  markings: THREE.InstancedMesh[];
  stores: THREE.Group[];
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
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(size + 800, size + 800).rotateX(-Math.PI / 2), material(CITY_COLORS.grass));
  grass.position.set(size / 2, -0.05, size / 2);
  grass.receiveShadow = true;
  grass.name = "grass";
  const pad = half + 4;
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(size + 2 * pad, size + 2 * pad).rotateX(-Math.PI / 2), material(CITY_COLORS.asphalt));
  asphalt.position.set(size / 2, 0, size / 2);
  asphalt.receiveShadow = true;
  asphalt.name = "asphalt";
  group.add(grass, asphalt);
}

function buildBlocks(plan: CityPlan, group: THREE.Group, half: number): void {
  const { xs, zs } = gridLines(plan);
  const walk: Box[] = [];
  const lawn: Box[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) {
      const x0 = xs[i] + half;
      const x1 = xs[i + 1] - half;
      const z0 = zs[j] + half;
      const z1 = zs[j + 1] - half;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      walk.push({ x: cx, y: 0.09, z: cz, sx: x1 - x0, sy: 0.18, sz: z1 - z0 });
      lawn.push({ x: cx, y: 0.1, z: cz, sx: x1 - x0 - 5, sy: 0.2, sz: z1 - z0 - 5 });
    }
  }
  const walks = boxes(walk, material(CITY_COLORS.sidewalk));
  walks.name = "sidewalks";
  walks.receiveShadow = true;
  const lawns = boxes(lawn, material(CITY_COLORS.lawn));
  lawns.name = "lawns";
  lawns.receiveShadow = true;
  group.add(walks, lawns);
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

function buildingColor(id: number, height: number): string {
  const list = height >= 28 ? GLASS : WARM;
  return list[Math.floor(hash(id, 3) * list.length)];
}

function buildBuildings(plan: CityPlan, group: THREE.Group): { meshes: THREE.Mesh[]; windows: THREE.InstancedMesh } {
  const meshes: THREE.Mesh[] = [];
  const win: Box[] = [];
  const winColors: string[] = [];
  for (const b of plan.buildings) {
    const pts = b.footprint.map(([x, z]) => new THREE.Vector2(x, -z));
    const body = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: b.height_m, bevelEnabled: false }).rotateX(-Math.PI / 2);
    const color = buildingColor(b.id, b.height_m);
    const mesh = new THREE.Mesh(body, material(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `building-${b.id}`;
    const roof = new THREE.Mesh(
      new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.5, bevelEnabled: false }).rotateX(-Math.PI / 2),
      material(`#${new THREE.Color(color).multiplyScalar(0.78).getHexString()}`),
    );
    roof.position.y = b.height_m;
    mesh.add(roof);
    meshes.push(mesh);
    group.add(mesh);

    const cx = b.footprint.reduce((s, p) => s + p[0], 0) / b.footprint.length;
    const cz = b.footprint.reduce((s, p) => s + p[1], 0) / b.footprint.length;
    const n = b.footprint.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = b.footprint[i];
      const [bx, bz] = b.footprint[(i + 1) % n];
      const len = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      let nx = uz;
      let nz = -ux;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      if (nx * (mx - cx) + nz * (mz - cz) < 0) {
        nx = -nx;
        nz = -nz;
      }
      const yaw = Math.atan2(-uz, ux);
      const cols = Math.floor(len / WINDOW_STEP_M);
      const rows = Math.floor((b.height_m - 1.5) / FLOOR_M);
      for (let c = 0; c < cols; c++) {
        const along = (c + 0.5) * (len / cols);
        for (let r = 0; r < rows; r++) {
          win.push({
            x: ax + ux * along + nx * 0.06,
            y: 1.9 + r * FLOOR_M,
            z: az + uz * along + nz * 0.06,
            sx: 1.7,
            sy: 1.5,
            sz: 0.12,
            yaw,
          });
          winColors.push(hash(b.id, i * 131 + c, r) > 0.7 ? CITY_COLORS.windowLit : CITY_COLORS.window);
        }
      }
    }
  }
  const windows = boxes(win, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1 }), winColors);
  windows.name = "windows";
  group.add(windows);
  return { meshes, windows };
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

export function buildCity(plan: CityPlan): CityParts {
  const group = new THREE.Group();
  group.name = "city";
  const half = roadWidth(plan.grid) / 2;
  buildGround(plan, group, half);
  buildBlocks(plan, group, half);
  const markings = buildMarkings(plan, group, half);
  const { meshes, windows } = buildBuildings(plan, group);
  const stores = plan.stores.map((st) => buildStore(st, plan.world.size_m));
  group.add(...stores);
  return { group, buildings: meshes, windows, markings, stores };
}
