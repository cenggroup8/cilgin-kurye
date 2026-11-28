import * as THREE from "three";
import { hash } from "./city.ts";
import { roadWidth } from "./pose.ts";
import type { CityPlan, SceneObstacle } from "./types.ts";

export const BARRIER_SPAN_M = 20;
export const PUDDLE_LENGTH_M = 8;
const CAPACITY = { cone: 320, band: 320, board: 320, leg: 160, body: 48, cabin: 48, puddle: 48, sign: 48 };

export interface Placement {
  x: number;
  z: number;
  ux: number;
  uz: number;
  yaw: number;
  side: number;
  width: number;
}

export function placeObstacle(plan: CityPlan, o: SceneObstacle): Placement | null {
  const seg = plan.segments.find((s) => s.id === o.segment);
  if (!seg) return null;
  const a = plan.nodes.find((n) => n.id === seg.a);
  const b = plan.nodes.find((n) => n.id === seg.b);
  if (!a || !b) return null;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  const lane = plan.grid.lane_width_m;
  const side = o.lane === 0 ? 0 : o.lane <= 2 ? (o.lane - 0.5) * lane : -(o.lane - 2.5) * lane;
  const pos = Math.min(1, Math.max(0, o.pos));
  return {
    x: a.x + ux * len * pos - uz * side,
    z: a.z + uz * len * pos + ux * side,
    ux,
    uz,
    yaw: Math.atan2(-uz, ux),
    side,
    width: o.lane === 0 ? roadWidth(plan.grid) : lane,
  };
}

type Part = { along: number; side: number; y: number; sx: number; sy: number; sz: number; turn?: number; color?: string };

function layer(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.name = name;
  return mesh;
}

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7, ...extra });

export class ObstacleLayer {
  readonly group = new THREE.Group();
  private readonly plan: CityPlan;
  private readonly meshes: Record<keyof typeof CAPACITY, THREE.InstancedMesh>;
  private key = "";
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly color = new THREE.Color();

  constructor(plan: CityPlan) {
    this.plan = plan;
    this.group.name = "obstacles";
    const puddle = layer(
      new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: "#6cc4ff", emissive: "#2f8fd8", emissiveIntensity: 0.35, transparent: true, opacity: 0.8, roughness: 0.05, metalness: 0.1, depthWrite: false }),
      CAPACITY.puddle,
      "puddles",
    );
    puddle.castShadow = false;
    puddle.receiveShadow = true;
    this.meshes = {
      cone: layer(new THREE.ConeGeometry(0.2, 0.62, 8).translate(0, 0.31, 0), mat("#ff7a1a"), CAPACITY.cone, "cones"),
      band: layer(new THREE.CylinderGeometry(0.125, 0.155, 0.1, 8), mat("#f5f5f0"), CAPACITY.band, "cone-bands"),
      board: layer(new THREE.BoxGeometry(1, 1, 1), mat("#ffffff"), CAPACITY.board, "barrier-boards"),
      leg: layer(new THREE.BoxGeometry(1, 1, 1), mat("#3a3d44"), CAPACITY.leg, "barrier-legs"),
      body: layer(new THREE.BoxGeometry(1, 1, 1), mat("#ffffff", { roughness: 0.45 }), CAPACITY.body, "crash-bodies"),
      cabin: layer(new THREE.BoxGeometry(1, 1, 1), mat("#24303d", { roughness: 0.3 }), CAPACITY.cabin, "crash-cabins"),
      puddle,
      sign: layer(new THREE.ConeGeometry(0.42, 0.06, 3).rotateX(Math.PI / 2).translate(0, 0.38, 0), mat("#e8322a"), CAPACITY.sign, "warning-signs"),
    };
    this.group.add(...Object.values(this.meshes));
  }

  get counts(): Record<string, number> {
    return Object.fromEntries(Object.entries(this.meshes).map(([k, v]) => [k, v.count]));
  }

  update(list: readonly SceneObstacle[]): void {
    const key = list.map((o) => `${o.id}:${o.type}:${o.segment}:${o.lane}:${o.pos}`).join("|");
    if (key === this.key) return;
    this.key = key;
    const parts: Record<keyof typeof CAPACITY, Part[]> = { cone: [], band: [], board: [], leg: [], body: [], cabin: [], puddle: [], sign: [] };
    const placed: { p: Placement; parts: typeof parts }[] = [];
    for (const o of list) {
      const p = placeObstacle(this.plan, o);
      if (!p) continue;
      const own: typeof parts = { cone: [], band: [], board: [], leg: [], body: [], cabin: [], puddle: [], sign: [] };
      if (o.type === "road_work") this.roadWork(own);
      else if (o.type === "accident") this.accident(own, o, p);
      else if (o.type === "puddle") own.puddle.push({ along: 0, side: 0, y: 0.03, sx: PUDDLE_LENGTH_M, sy: 1, sz: p.width * 0.95 });
      placed.push({ p, parts: own });
    }
    for (const key of Object.keys(parts) as (keyof typeof CAPACITY)[]) {
      const mesh = this.meshes[key];
      let n = 0;
      for (const { p, parts: own } of placed) {
        for (const part of own[key]) {
          if (n >= CAPACITY[key]) break;
          this.write(mesh, n++, p, part);
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private roadWork(out: Record<keyof typeof CAPACITY, Part[]>): void {
    const half = BARRIER_SPAN_M / 2;
    for (let s = -half, i = 0; s < half; s += 1, i++) {
      out.board.push({ along: 0, side: s + 0.5, y: 0.95, sx: 0.12, sy: 0.32, sz: 1, color: i % 2 ? "#e8322a" : "#f5f5f0" });
      out.board.push({ along: 0, side: s + 0.5, y: 0.45, sx: 0.12, sy: 0.22, sz: 1, color: i % 2 ? "#f5f5f0" : "#e8322a" });
    }
    for (let s = -half + 0.5; s <= half - 0.5; s += 2.4) out.leg.push({ along: 0, side: s, y: 0.55, sx: 0.36, sy: 1.1, sz: 0.08 });
    for (const along of [-3.2, 3.2]) {
      for (let s = -half + 3; s <= half - 3; s += 2.2) this.cone(out, along, s);
    }
    out.sign.push({ along: -6, side: -4, y: 0, sx: 1, sy: 1, sz: 1, turn: Math.PI / 2 });
    out.sign.push({ along: 6, side: 4, y: 0, sx: 1, sy: 1, sz: 1, turn: -Math.PI / 2 });
  }

  private accident(out: Record<keyof typeof CAPACITY, Part[]>, o: SceneObstacle, p: Placement): void {
    const paint = ["#d0533f", "#3f6fb5", "#e4e6ea", "#2e333b", "#5c9a7f"][Math.floor(hash(o.id, 5) * 5)];
    const turn = (o.lane === 0 ? 1.15 : 0.6) * (hash(o.id, 9) > 0.5 ? 1 : -1);
    out.body.push({ along: 0, side: 0, y: 0.62, sx: 4.4, sy: 0.8, sz: 1.85, turn, color: paint });
    out.cabin.push({ along: -0.25, side: 0, y: 1.3, sx: 2.1, sy: 0.6, sz: 1.6, turn });
    const reach = p.width / 2 - 0.4;
    for (const along of [-3.4, 3.4]) {
      for (let s = -reach; s <= reach + 0.01; s += Math.max(1.1, (2 * reach) / 3)) this.cone(out, along, s);
    }
    out.sign.push({ along: -8, side: 0, y: 0, sx: 1, sy: 1, sz: 1, turn: Math.PI / 2 });
  }

  private cone(out: Record<keyof typeof CAPACITY, Part[]>, along: number, side: number): void {
    out.cone.push({ along, side, y: 0, sx: 1, sy: 1, sz: 1 });
    out.band.push({ along, side, y: 0.32, sx: 1, sy: 1, sz: 1 });
  }

  private write(mesh: THREE.InstancedMesh, i: number, p: Placement, part: Part): void {
    const rx = -p.uz;
    const rz = p.ux;
    const pos = new THREE.Vector3(p.x + p.ux * part.along + rx * part.side, part.y, p.z + p.uz * part.along + rz * part.side);
    this.q.setFromAxisAngle(this.up, p.yaw + (part.turn ?? 0));
    this.m.compose(pos, this.q, new THREE.Vector3(part.sx, part.sy, part.sz));
    mesh.setMatrixAt(i, this.m);
    if (part.color) mesh.setColorAt(i, this.color.set(part.color));
  }
}
