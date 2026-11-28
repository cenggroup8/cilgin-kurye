import * as THREE from "three";
import { hash, LAWN_TOP, SIDEWALK_TOP } from "./city.ts";
import { roadWidth, teamColor } from "./pose.ts";
import { texture, type TextureName } from "./textures.ts";
import type { CityPlan } from "./types.ts";

type V = [number, number, number];
type Skin = TextureName | "plain";

const HOUSE_WALLS = ["#f6eedd", "#f3e2c4", "#e9efe6", "#f1ddd3", "#e6ebf2", "#f5e9b9"];
const ROOF_TILES = ["#c4543c", "#b5473a", "#cf6a46", "#9e4636", "#a95a3f"];
const APT_WALLS = ["#f0e6d6", "#e7d3b9", "#dfe3e6", "#ead9c6", "#d9cfc2", "#efe1cf"];
const TRIM = "#e8e4dc";

export const FLOOR_M = 3;
export const HOUSE_EAVE_M = 5.8;

class Batch {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];

  private push(p: V, n: THREE.Vector3, uv: [number, number], c: THREE.Color): void {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(uv[0], uv[1]);
    this.col.push(c.r, c.g, c.b);
  }

  tri(a: V, b: V, c: V, ua: [number, number], ub: [number, number], uc: [number, number], color: THREE.Color): void {
    const n = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])).normalize();
    this.push(a, n, ua, color);
    this.push(b, n, ub, color);
    this.push(c, n, uc, color);
  }

  quad(a: V, b: V, c: V, d: V, uv: [number, number, number, number], color: THREE.Color): void {
    const [u0, v0, u1, v1] = uv;
    this.tri(a, b, c, [u0, v0], [u1, v0], [u1, v1], color);
    this.tri(a, c, d, [u0, v0], [u1, v1], [u0, v1], color);
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

export class Town {
  private readonly batches = new Map<Skin, Batch>();
  readonly trees: { x: number; z: number; s: number; tint: number }[] = [];
  readonly benches: { x: number; z: number; yaw: number }[] = [];
  private readonly c = new THREE.Color();

  batch(skin: Skin): Batch {
    let b = this.batches.get(skin);
    if (!b) {
      b = new Batch();
      this.batches.set(skin, b);
    }
    return b;
  }

  color(hex: string): THREE.Color {
    return this.c.set(hex).clone();
  }

  wall(skin: Skin, p0: [number, number], p1: [number, number], y0: number, y1: number, color: THREE.Color, bay: number, floor: number, uOffset = 0): void {
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const u0 = uOffset;
    const u1 = uOffset + Math.max(1, Math.round(len / bay));
    this.batch(skin).quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], [u0, y0 / floor, u1, y1 / floor], color);
  }

  walls(skin: Skin, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, color: THREE.Color, bay: number, floor: number): void {
    const ring: [number, number][] = [[x0, z1], [x1, z1], [x1, z0], [x0, z0], [x0, z1]];
    for (let i = 0; i < 4; i++) this.wall(skin, ring[i], ring[i + 1], y0, y1, color, bay, floor);
  }

  top(skin: Skin, x0: number, z0: number, x1: number, z1: number, y: number, color: THREE.Color, tile: number): void {
    this.batch(skin).quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [x0 / tile, -z1 / tile, x1 / tile, -z0 / tile], color);
  }

  box(skin: Skin, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, color: THREE.Color, tile = 4): void {
    this.walls(skin, x0, z0, x1, z1, y0, y1, color, tile, tile);
    this.top(skin, x0, z0, x1, z1, y1, color, tile);
  }

  gable(x0: number, z0: number, x1: number, z1: number, eave: number, rise: number, alongX: boolean, roof: THREE.Color, wall: THREE.Color, wallSkin: Skin): void {
    const o = 0.45;
    const r = this.batch("roofTile");
    if (alongX) {
      const zm = (z0 + z1) / 2;
      const top = eave + rise;
      const slope = Math.hypot(rise, (z1 - z0) / 2 + o);
      r.quad([x0 - o, eave - 0.2, z1 + o], [x1 + o, eave - 0.2, z1 + o], [x1 + o, top, zm], [x0 - o, top, zm], [0, 0, (x1 - x0 + 2 * o) / 2, slope / 1.1], roof);
      r.quad([x1 + o, eave - 0.2, z0 - o], [x0 - o, eave - 0.2, z0 - o], [x0 - o, top, zm], [x1 + o, top, zm], [0, 0, (x1 - x0 + 2 * o) / 2, slope / 1.1], roof);
      const w = this.batch(wallSkin);
      w.tri([x0, eave, z0], [x0, eave, z1], [x0, top, zm], [0, eave / FLOOR_M], [1, eave / FLOOR_M], [0.5, top / FLOOR_M], wall);
      w.tri([x1, eave, z1], [x1, eave, z0], [x1, top, zm], [0, eave / FLOOR_M], [1, eave / FLOOR_M], [0.5, top / FLOOR_M], wall);
    } else {
      const xm = (x0 + x1) / 2;
      const top = eave + rise;
      const slope = Math.hypot(rise, (x1 - x0) / 2 + o);
      r.quad([x1 + o, eave - 0.2, z1 + o], [x1 + o, eave - 0.2, z0 - o], [xm, top, z0 - o], [xm, top, z1 + o], [0, 0, (z1 - z0 + 2 * o) / 2, slope / 1.1], roof);
      r.quad([x0 - o, eave - 0.2, z0 - o], [x0 - o, eave - 0.2, z1 + o], [xm, top, z1 + o], [xm, top, z0 - o], [0, 0, (z1 - z0 + 2 * o) / 2, slope / 1.1], roof);
      const w = this.batch(wallSkin);
      w.tri([x1, eave, z0], [x0, eave, z0], [xm, top, z0], [0, eave / FLOOR_M], [1, eave / FLOOR_M], [0.5, top / FLOOR_M], wall);
      w.tri([x0, eave, z1], [x1, eave, z1], [xm, top, z1], [0, eave / FLOOR_M], [1, eave / FLOOR_M], [0.5, top / FLOOR_M], wall);
    }
  }

  door(side: "n" | "s" | "e" | "w", x: number, z: number, width: number, height: number, y0: number): void {
    const d = this.batch("door");
    const c = this.color("#ffffff");
    const h = width / 2;
    const e = 0.04;
    if (side === "s") d.quad([x - h, y0, z + e], [x + h, y0, z + e], [x + h, y0 + height, z + e], [x - h, y0 + height, z + e], [0, 0, 1, 1], c);
    if (side === "n") d.quad([x + h, y0, z - e], [x - h, y0, z - e], [x - h, y0 + height, z - e], [x + h, y0 + height, z - e], [0, 0, 1, 1], c);
    if (side === "e") d.quad([x + e, y0, z + h], [x + e, y0, z - h], [x + e, y0 + height, z - h], [x + e, y0 + height, z + h], [0, 0, 1, 1], c);
    if (side === "w") d.quad([x - e, y0, z - h], [x - e, y0, z + h], [x - e, y0 + height, z + h], [x - e, y0 + height, z - h], [0, 0, 1, 1], c);
  }

  meshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [skin, b] of this.batches) {
      if (!b.pos.length) continue;
      const map = skin === "plain" ? null : texture(skin);
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        map,
        roughness: skin === "glass" ? 0.2 : skin === "metal" ? 0.5 : 0.85,
        metalness: skin === "glass" ? 0.3 : 0,
        side: skin === "metal" ? THREE.DoubleSide : THREE.FrontSide,
      });
      const m = new THREE.Mesh(b.geometry(), mat);
      m.name = `town-${skin}`;
      m.castShadow = skin !== "grass" && skin !== "plaza" && skin !== "sidewalk";
      m.receiveShadow = true;
      out.push(m);
    }
    return out;
  }

  get triangles(): number {
    let n = 0;
    for (const b of this.batches.values()) n += b.triangles;
    return n;
  }
}

function inside(poly: readonly (readonly number[])[], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

function fits(poly: readonly (readonly number[])[], x0: number, z0: number, x1: number, z1: number): boolean {
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [(x0 + x1) / 2, (z0 + z1) / 2]].every(([x, z]) => inside(poly, x, z));
}

function pick<T>(list: readonly T[], ...seed: number[]): T {
  return list[Math.floor(hash(seed[0] ?? 0, seed[1] ?? 0, seed[2] ?? 0) * list.length) % list.length];
}

function house(t: Town, id: number, k: number, x0: number, z0: number, x1: number, z1: number, front: "n" | "s" | "e" | "w"): void {
  const wall = t.color(pick(HOUSE_WALLS, id, k, 1));
  const roof = t.color(pick(ROOF_TILES, id, k, 2));
  const eave = HOUSE_EAVE_M + (hash(id, k, 3) > 0.7 ? 2.9 : 0);
  t.walls("houseWall", x0, z0, x1, z1, LAWN_TOP, eave, wall, 3, FLOOR_M);
  t.box("plain", x0 - 0.15, z0 - 0.15, x1 + 0.15, z1 + 0.15, LAWN_TOP, LAWN_TOP + 0.5, t.color("#a49c90"), 4);
  const alongX = front === "n" || front === "s";
  t.gable(x0, z0, x1, z1, eave, 2.6 + hash(id, k, 4) * 1.2, alongX, roof, wall, "houseWall");
  const cx = (x0 + x1) / 2 + (hash(id, k, 5) - 0.5) * 2;
  const cz = (z0 + z1) / 2 + (hash(id, k, 6) - 0.5) * 2;
  if (front === "s") t.door("s", cx, z1, 1.2, 2.3, LAWN_TOP + 0.5);
  if (front === "n") t.door("n", cx, z0, 1.2, 2.3, LAWN_TOP + 0.5);
  if (front === "e") t.door("e", x1, cz, 1.2, 2.3, LAWN_TOP + 0.5);
  if (front === "w") t.door("w", x0, cz, 1.2, 2.3, LAWN_TOP + 0.5);
  const chx = x0 + (x1 - x0) * (0.25 + hash(id, k, 7) * 0.5);
  const chz = z0 + (z1 - z0) * (0.3 + hash(id, k, 8) * 0.4);
  t.box("plain", chx - 0.45, chz - 0.45, chx + 0.45, chz + 0.45, eave + 1, eave + 4.2, t.color("#8c5a48"), 4);
}

function houses(t: Town, b: CityPlan["buildings"][number], x0: number, z0: number, x1: number, z1: number): void {
  const set = 4;
  const depth = 10;
  let k = 0;
  const row = (side: "n" | "s" | "e" | "w", from: number, to: number) => {
    let p = from;
    while (p < to - 9) {
      const w = 11 + Math.floor(hash(b.id, k, 11) * 4);
      const end = Math.min(p + w, to);
      if (end - p >= 9) {
        let r: [number, number, number, number];
        if (side === "n") r = [p, z0 + set, end, z0 + set + depth];
        else if (side === "s") r = [p, z1 - set - depth, end, z1 - set];
        else if (side === "w") r = [x0 + set, p, x0 + set + depth, end];
        else r = [x1 - set - depth, p, x1 - set, end];
        if (fits(b.footprint, r[0] - 0.5, r[1] - 0.5, r[2] + 0.5, r[3] + 0.5)) house(t, b.id, k, r[0], r[1], r[2], r[3], side);
      }
      p = end + 3 + hash(b.id, k, 12) * 2;
      k++;
    }
  };
  row("n", x0 + set, x1 - set);
  row("s", x0 + set, x1 - set);
  row("w", z0 + set + depth + 4, z1 - set - depth - 4);
  row("e", z0 + set + depth + 4, z1 - set - depth - 4);
  const inner = [x0 + set + depth + 4, z0 + set + depth + 4, x1 - set - depth - 4, z1 - set - depth - 4];
  for (let i = 0; i < 9; i++) {
    const x = inner[0] + hash(b.id, i, 21) * (inner[2] - inner[0]);
    const z = inner[1] + hash(b.id, i, 22) * (inner[3] - inner[1]);
    if (inside(b.footprint, x, z)) t.trees.push({ x, z, s: 0.8 + hash(b.id, i, 23) * 0.6, tint: hash(b.id, i, 24) });
  }
  for (const [x, z] of [[x0 + 2, z0 + 2], [x1 - 2, z0 + 2], [x0 + 2, z1 - 2], [x1 - 2, z1 - 2]]) {
    if (inside(b.footprint, x, z)) t.trees.push({ x, z, s: 0.7, tint: hash(b.id, x, z) });
  }
}

function slab(t: Town, id: number, k: number, x0: number, z0: number, x1: number, z1: number, top: number): void {
  const tint = t.color(pick(APT_WALLS, id, k, 31));
  const shop = 4;
  t.walls("aptShop", x0, z0, x1, z1, LAWN_TOP, LAWN_TOP + shop, t.color("#ffffff"), 5, shop);
  const floors = Math.max(3, Math.floor((top - shop - 1) / FLOOR_M));
  const roofY = LAWN_TOP + shop + floors * FLOOR_M;
  t.walls("aptWall", x0, z0, x1, z1, LAWN_TOP + shop, roofY, tint, 4, FLOOR_M);
  t.box("plain", x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3, LAWN_TOP + shop - 0.1, LAWN_TOP + shop + 0.35, t.color(TRIM), 4);
  t.box("plain", x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2, roofY, roofY + 0.9, t.color("#d4cdc0"), 4);
  t.top("roofFlat", x0 + 0.2, z0 + 0.2, x1 - 0.2, z1 - 0.2, roofY + 0.2, t.color("#ffffff"), 6);
  const units = 2 + Math.floor(hash(id, k, 32) * 3);
  for (let i = 0; i < units; i++) {
    const ux = x0 + 3 + hash(id, k, 40 + i) * (x1 - x0 - 8);
    const uz = z0 + 3 + hash(id, k, 50 + i) * (z1 - z0 - 8);
    t.box("plain", ux, uz, ux + 2.4, uz + 1.8, roofY + 0.2, roofY + 1.6, t.color("#b9bdc3"), 4);
  }
}

function apartments(t: Town, b: CityPlan["buildings"][number], x0: number, z0: number, x1: number, z1: number): void {
  const set = 3;
  const d = 14;
  const style = hash(b.id, 0, 60);
  const ring: [number, number, number, number][] =
    style < 0.35
      ? [
          [x0 + set, z0 + set, x1 - set, z0 + set + d],
          [x0 + set, z1 - set - d, x1 - set, z1 - set],
        ]
      : [
          [x0 + set, z0 + set, x1 - set, z0 + set + d],
          [x0 + set, z1 - set - d, x1 - set, z1 - set],
          [x0 + set, z0 + set + d + 6, x0 + set + d, z1 - set - d - 6],
          [x1 - set - d, z0 + set + d + 6, x1 - set, z1 - set - d - 6],
        ];
  ring.forEach((r, k) => {
    const top = b.height_m - hash(b.id, k, 61) * 5;
    if (fits(b.footprint, r[0], r[1], r[2], r[3])) slab(t, b.id, k, r[0], r[1], r[2], r[3], top);
  });
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + hash(b.id, i, 62);
    t.trees.push({ x: cx + Math.cos(a) * 11, z: cz + Math.sin(a) * 11, s: 0.75 + hash(b.id, i, 63) * 0.4, tint: hash(b.id, i, 64) });
  }
  for (let i = 0; i < 4; i++) t.benches.push({ x: cx + (i % 2 ? 5 : -5), z: cz + (i < 2 ? -3 : 3), yaw: i < 2 ? 0 : Math.PI });
}

function tower(t: Town, b: CityPlan["buildings"][number], x0: number, z0: number, x1: number, z1: number): void {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const glass = t.color("#ffffff");
  const p = 24;
  t.walls("glass", cx - p, cz - p, cx + p, cz + p, LAWN_TOP, LAWN_TOP + 7, glass, 4, 3.5);
  t.box("plain", cx - p - 0.6, cz - p - 0.6, cx + p + 0.6, cz + p + 0.6, LAWN_TOP + 7, LAWN_TOP + 8, t.color(TRIM), 4);
  t.top("roofFlat", cx - p, cz - p, cx + p, cz + p, LAWN_TOP + 8.01, t.color("#ffffff"), 6);
  const tiers: [number, number][] = [
    [15, b.height_m * 0.55],
    [12, b.height_m * 0.82],
    [9, b.height_m - 3],
  ];
  let y = LAWN_TOP + 8;
  for (const [h, top] of tiers) {
    t.walls("glass", cx - h, cz - h, cx + h, cz + h, y, top, glass, 3, 3.5);
    t.box("plain", cx - h - 0.4, cz - h - 0.4, cx + h + 0.4, cz + h + 0.4, top, top + 0.7, t.color(TRIM), 4);
    t.top("roofFlat", cx - h, cz - h, cx + h, cz + h, top + 0.71, t.color("#ffffff"), 6);
    y = top + 0.7;
  }
  t.box("plain", cx - 0.25, cz - 0.25, cx + 0.25, cz + 0.25, y, b.height_m + 4, t.color("#c9ced6"), 4);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    t.trees.push({ x: cx + Math.cos(a) * 31, z: cz + Math.sin(a) * 31, s: 0.7, tint: hash(b.id, i, 70) });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    t.benches.push({ x: cx + Math.cos(a) * 28, z: cz + Math.sin(a) * 28, yaw: -a + Math.PI / 2 });
  }
}

function depot(t: Town, store: CityPlan["stores"][number], size: number): void {
  if (!store.depot) return;
  const xs = store.depot.footprint.map((p) => p[0]);
  const zs = store.depot.footprint.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  const team = t.color(teamColor(store.team));
  const white = t.color("#ffffff");
  const eave = 8;
  const west = x0 < size / 2;
  const north = z0 < size / 2;
  const back: ["n" | "s" | "e" | "w", [number, number], [number, number]][] = [
    west ? ["e", [x1, z1], [x1, z0]] : ["w", [x0, z0], [x0, z1]],
    north ? ["s", [x0, z1], [x1, z1]] : ["n", [x1, z0], [x0, z0]],
  ];
  for (const [, a, c] of back) t.wall("metal", a, c, SIDEWALK_TOP, eave, white, 4, eave);
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, west ? z0 : z1], [west ? x0 : x1, (z0 + z1) / 2]]) {
    t.box("plain", x - 0.35, z - 0.35, x + 0.35, z + 0.35, SIDEWALK_TOP, eave, t.color("#d7d7d7"), 4);
  }
  const roof = t.batch("metal");
  const xm = (x0 + x1) / 2;
  const top = eave + 4;
  const o = 0.8;
  roof.quad([x1 + o, eave, z1 + o], [x1 + o, eave, z0 - o], [xm, top, z0 - o], [xm, top, z1 + o], [0, 0, (z1 - z0) / 4, 6], team);
  roof.quad([x0 - o, eave, z0 - o], [x0 - o, eave, z1 + o], [xm, top, z1 + o], [xm, top, z0 - o], [0, 0, (z1 - z0) / 4, 6], team);
  t.box("plain", x0 - o, z0 - o, x1 + o, z0 - o + 0.3, eave - 0.6, eave, white, 4);
  t.box("plain", x0 - o, z1 + o - 0.3, x1 + o, z1 + o, eave - 0.6, eave, white, 4);
}

function ground(t: Town, plan: CityPlan): void {
  const half = roadWidth(plan.grid) / 2;
  const xs = [...new Set(plan.nodes.map((n) => n.x))].sort((a, b) => a - b);
  const zs = [...new Set(plan.nodes.map((n) => n.z))].sort((a, b) => a - b);
  const kinds = new Map(plan.buildings.map((b) => [b.block ?? "", b.kind ?? "houses"]));
  const walk = t.color("#ffffff");
  for (let i = 0; i + 1 < zs.length; i++) {
    for (let j = 0; j + 1 < xs.length; j++) {
      const x0 = xs[j] + half;
      const x1 = xs[j + 1] - half;
      const z0 = zs[i] + half;
      const z1 = zs[i + 1] - half;
      t.top("sidewalk", x0, z0, x1, z1, SIDEWALK_TOP, walk, 2);
      t.walls("sidewalk", x0, z0, x1, z1, 0, SIDEWALK_TOP, t.color("#d8d4cc"), 2, 2);
      const kind = kinds.get(`b_${i}_${j}`) ?? "houses";
      const skin: Skin = kind === "houses" ? "grass" : "plaza";
      t.top(skin, x0 + 3, z0 + 3, x1 - 3, z1 - 3, LAWN_TOP, t.color("#ffffff"), skin === "grass" ? 5 : 4);
      t.walls("plain", x0 + 3, z0 + 3, x1 - 3, z1 - 3, SIDEWALK_TOP - 0.01, LAWN_TOP, t.color("#9e978b"), 4, 4);
    }
  }
  for (const s of plan.stores) {
    if (!s.depot) continue;
    const fx = s.depot.footprint.map((p) => p[0]);
    const fz = s.depot.footprint.map((p) => p[1]);
    t.top("plaza", Math.min(...fx) - 1, Math.min(...fz) - 1, Math.max(...fx) + 1, Math.max(...fz) + 1, LAWN_TOP + 0.01, t.color("#ffffff"), 4);
  }
}

export function buildTown(plan: CityPlan): Town {
  const t = new Town();
  ground(t, plan);
  for (const b of plan.buildings) {
    const xs = b.footprint.map((p) => p[0]);
    const zs = b.footprint.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs);
    const kind = b.kind ?? (b.height_m > 40 ? "tower" : b.height_m > 18 ? "apartments" : "houses");
    if (kind === "tower") tower(t, b, x0, z0, x1, z1);
    else if (kind === "apartments") apartments(t, b, x0, z0, x1, z1);
    else houses(t, b, x0, z0, x1, z1);
  }
  for (const s of plan.stores) depot(t, s, plan.world.size_m);
  return t;
}
