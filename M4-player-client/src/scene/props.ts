import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LAWN_TOP, SIDEWALK_TOP } from "./city.ts";
import { roadWidth } from "./pose.ts";
import type { CityPlan } from "./types.ts";

const LEAVES = ["#4f9a46", "#5aa84c", "#3f8a3e", "#6bb458", "#4a8f52"];
const CYCLE_S = 14;
const GREEN_S = 5.5;
const YELLOW_S = 1.5;
const LIGHT = { red: new THREE.Color("#ff3b30"), yellow: new THREE.Color("#ffc02e"), green: new THREE.Color("#3ddc84"), off: new THREE.Color("#2a2d33") };

function colored(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute("uv");
  const c = new THREE.Color(color);
  const n = geo.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

function kit(parts: [THREE.BufferGeometry, string][]): THREE.BufferGeometry {
  return mergeGeometries(parts.map(([g, c]) => colored(g, c)), false)!;
}

const lit = () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7 });

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, count: number, name: string): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
  m.count = 0;
  m.castShadow = true;
  m.name = name;
  return m;
}

export interface Signal {
  x: number;
  z: number;
  yaw: number;
  axis: 0 | 1;
}

export class Props {
  readonly group = new THREE.Group();
  readonly signals: Signal[] = [];
  readonly lamps: { x: number; z: number; yaw: number }[] = [];
  private readonly bulbs: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly one = new THREE.Vector3(1, 1, 1);
  private shown = -1;

  constructor(plan: CityPlan, trees: readonly { x: number; z: number; s: number; tint: number }[], benches: readonly { x: number; z: number; yaw: number }[]) {
    this.group.name = "props";
    this.placeStreet(plan);

    const crown = kit([[new THREE.IcosahedronGeometry(2.2, 1).scale(1, 1.15, 1).translate(0, 4.1, 0), "#ffffff"], [new THREE.IcosahedronGeometry(1.5, 1).translate(0.6, 5.6, -0.3), "#ffffff"]]);
    const trunk = kit([[new THREE.CylinderGeometry(0.16, 0.26, 2.6, 6).translate(0, 1.3, 0), "#7a5332"]]);
    const crowns = instanced(crown, lit(), trees.length, "tree-crowns");
    const trunks = instanced(trunk, lit(), trees.length, "tree-trunks");
    const c = new THREE.Color();
    trees.forEach((t, i) => {
      this.q.setFromAxisAngle(this.up, t.tint * 6.28);
      this.m.compose(new THREE.Vector3(t.x, LAWN_TOP, t.z), this.q, new THREE.Vector3(t.s, t.s, t.s));
      crowns.setMatrixAt(i, this.m);
      trunks.setMatrixAt(i, this.m);
      crowns.setColorAt(i, c.set(LEAVES[Math.floor(t.tint * LEAVES.length) % LEAVES.length]));
    });
    crowns.count = trunks.count = trees.length;

    const bench = kit([
      [new THREE.BoxGeometry(1.8, 0.08, 0.45).translate(0, 0.46, 0), "#8a5a36"],
      [new THREE.BoxGeometry(1.8, 0.4, 0.06).translate(0, 0.76, 0.2), "#8a5a36"],
      [new THREE.BoxGeometry(0.08, 0.46, 0.4).translate(-0.8, 0.23, 0), "#3d4148"],
      [new THREE.BoxGeometry(0.08, 0.46, 0.4).translate(0.8, 0.23, 0), "#3d4148"],
    ]);
    const benchMesh = instanced(bench, lit(), benches.length, "benches");
    benches.forEach((b, i) => benchMesh.setMatrixAt(i, this.at(b.x, LAWN_TOP, b.z, b.yaw)));
    benchMesh.count = benches.length;

    const lamp = kit([
      [new THREE.CylinderGeometry(0.08, 0.12, 6.4, 8).translate(0, 3.2, 0), "#4a4f57"],
      [new THREE.BoxGeometry(0.08, 0.08, 1.7).translate(0, 6.3, -0.8), "#4a4f57"],
      [new THREE.BoxGeometry(0.34, 0.14, 0.62).translate(0, 6.22, -1.6), "#3a3e45"],
      [new THREE.BoxGeometry(0.28, 0.04, 0.5).translate(0, 6.13, -1.6), "#fff3c8"],
      [new THREE.CylinderGeometry(0.2, 0.24, 0.4, 8).translate(0, 0.2, 0), "#3a3e45"],
    ]);
    const lamps = instanced(lamp, lit(), this.lamps.length, "street-lamps");
    this.lamps.forEach((l, i) => lamps.setMatrixAt(i, this.at(l.x, SIDEWALK_TOP, l.z, l.yaw)));
    lamps.count = this.lamps.length;

    const pole = kit([
      [new THREE.CylinderGeometry(0.09, 0.12, 4.6, 8).translate(0, 2.3, 0), "#30343b"],
      [new THREE.BoxGeometry(0.42, 1.2, 0.3).translate(0, 4.2, -0.05), "#22252a"],
      [new THREE.BoxGeometry(0.5, 1.3, 0.04).translate(0, 4.2, 0.12), "#e8b400"],
      [new THREE.CylinderGeometry(0.2, 0.24, 0.3, 8).translate(0, 0.15, 0), "#30343b"],
    ]);
    const poles = instanced(pole, lit(), this.signals.length, "traffic-lights");
    this.signals.forEach((s, i) => poles.setMatrixAt(i, this.at(s.x, SIDEWALK_TOP, s.z, s.yaw)));
    poles.count = this.signals.length;

    this.bulbs = instanced(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: "#ffffff" }), this.signals.length * 3, "signal-bulbs");
    this.bulbs.castShadow = false;
    this.signals.forEach((s, i) => {
      for (let k = 0; k < 3; k++) {
        const base = this.at(s.x, SIDEWALK_TOP, s.z, s.yaw);
        const off = new THREE.Matrix4().makeTranslation(0, 4.58 - k * 0.38, -0.21);
        this.bulbs.setMatrixAt(i * 3 + k, base.multiply(off));
      }
    });
    this.bulbs.count = this.signals.length * 3;
    this.update(0);

    this.group.add(crowns, trunks, benchMesh, lamps, poles, this.bulbs);
  }

  private at(x: number, y: number, z: number, yaw: number): THREE.Matrix4 {
    this.q.setFromAxisAngle(this.up, yaw);
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), this.q, this.one);
  }

  private placeStreet(plan: CityPlan): void {
    const half = roadWidth(plan.grid) / 2;
    const edge = half + 2.6;
    const size = plan.world.size_m;
    const ok = (v: number) => v > -1 && v < size + 1;
    for (const n of plan.nodes) {
      const corners: [number, number, number, 0 | 1][] = [
        [edge, -edge, -Math.PI / 2, 0],
        [edge, edge, Math.PI, 1],
        [-edge, edge, Math.PI / 2, 0],
        [-edge, -edge, 0, 1],
      ];
      for (const [dx, dz, yaw, axis] of corners) {
        const x = n.x + dx;
        const z = n.z + dz;
        if (ok(x) && ok(z)) this.signals.push({ x, z, yaw, axis });
      }
    }
    const byId = new Map(plan.nodes.map((n) => [n.id, n]));
    for (const s of plan.segments) {
      const a = byId.get(s.a)!;
      const b = byId.get(s.b)!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      for (const side of [-1, 1]) {
        for (let d = 25; d < len - 20; d += 25) {
          const x = a.x + ux * d - uz * side * edge;
          const z = a.z + uz * d + ux * side * edge;
          if (!ok(x) || !ok(z)) continue;
          this.lamps.push({ x, z, yaw: Math.atan2(-uz * side, ux * side) });
        }
      }
    }
  }

  update(time: number): void {
    const phase = Math.floor(time * 4);
    if (phase === this.shown) return;
    this.shown = phase;
    const t = time % CYCLE_S;
    const lamp = (axis: 0 | 1) => {
      const local = (t + (axis ? CYCLE_S / 2 : 0)) % CYCLE_S;
      return local < GREEN_S ? 2 : local < GREEN_S + YELLOW_S ? 1 : 0;
    };
    this.signals.forEach((s, i) => {
      const on = lamp(s.axis);
      this.bulbs.setColorAt(i * 3, on === 0 ? LIGHT.red : LIGHT.off);
      this.bulbs.setColorAt(i * 3 + 1, on === 1 ? LIGHT.yellow : LIGHT.off);
      this.bulbs.setColorAt(i * 3 + 2, on === 2 ? LIGHT.green : LIGHT.off);
    });
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
  }
}
