import * as THREE from "three";
import { CITY_COLORS } from "./city.ts";

const SKID_LIFE = 18;
const SKID_WIDTH = 0.2;

interface Skid {
  born: number;
}

interface Puff {
  born: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
}

export class Effects {
  readonly group = new THREE.Group();
  private readonly skidMesh: THREE.InstancedMesh;
  private readonly puffMesh: THREE.InstancedMesh;
  private readonly skids: Skid[] = [];
  private readonly puffs: Puff[] = [];
  private skidHead = 0;
  private time = 0;
  private seed = 1;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly fresh = new THREE.Color("#121317");
  private readonly road = new THREE.Color(CITY_COLORS.asphalt);
  private readonly c = new THREE.Color();

  constructor(maxSkids = 900, maxPuffs = 220) {
    const skidMat = new THREE.MeshStandardMaterial({ roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.skidMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), skidMat, maxSkids);
    this.skidMesh.count = 0;
    this.skidMesh.frustumCulled = false;
    this.skidMesh.receiveShadow = true;
    this.skidMesh.name = "skids";
    for (let i = 0; i < maxSkids; i++) this.skids.push({ born: -Infinity });

    const puffMat = new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#d9d4ca", emissiveIntensity: 0.35, flatShading: true, roughness: 1, transparent: true, opacity: 0.75, depthWrite: false });
    this.puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), puffMat, maxPuffs);
    this.puffMesh.count = 0;
    this.puffMesh.frustumCulled = false;
    this.puffMesh.name = "puffs";
    this.group.add(this.skidMesh, this.puffMesh);
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  skid(ax: number, az: number, bx: number, bz: number): void {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05 || len > 4) return;
    const i = this.skidHead;
    this.skidHead = (this.skidHead + 1) % this.skids.length;
    this.skids[i].born = this.time;
    this.q.setFromAxisAngle(this.up, Math.atan2(-(bz - az), bx - ax));
    this.m.compose(new THREE.Vector3((ax + bx) / 2, 0.016, (az + bz) / 2), this.q, new THREE.Vector3(len + 0.05, 1, SKID_WIDTH));
    this.skidMesh.setMatrixAt(i, this.m);
    this.skidMesh.count = Math.max(this.skidMesh.count, i + 1);
    this.skidMesh.instanceMatrix.needsUpdate = true;
  }

  puff(x: number, y: number, z: number, size: number, spread: number, rise: number): void {
    if (this.puffs.length >= this.puffMesh.instanceMatrix.count) this.puffs.shift();
    this.puffs.push({
      born: this.time,
      life: 0.45 + this.random() * 0.35,
      x,
      y,
      z,
      vx: (this.random() - 0.5) * spread,
      vy: rise * (0.6 + this.random() * 0.6),
      vz: (this.random() - 0.5) * spread,
      size: size * (0.7 + this.random() * 0.6),
    });
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = 0; i < this.skidMesh.count; i++) {
      const age = Math.min(1, (this.time - this.skids[i].born) / SKID_LIFE);
      this.c.copy(this.fresh).lerp(this.road, age * age);
      this.skidMesh.setColorAt(i, this.c);
    }
    if (this.skidMesh.instanceColor) this.skidMesh.instanceColor.needsUpdate = true;

    let n = 0;
    for (let i = this.puffs.length - 1; i >= 0; i--) if (this.time - this.puffs[i].born > this.puffs[i].life) this.puffs.splice(i, 1);
    for (const p of this.puffs) {
      const t = (this.time - p.born) / p.life;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 0.94;
      p.vz *= 0.94;
      const grow = t < 0.25 ? 1 - Math.pow(1 - t / 0.25, 3) : 1 - Math.pow((t - 0.25) / 0.75, 2);
      const s = Math.max(0.001, p.size * grow);
      this.q.setFromAxisAngle(this.up, p.born * 7);
      this.m.compose(new THREE.Vector3(p.x, p.y, p.z), this.q, new THREE.Vector3(s, s, s));
      this.puffMesh.setMatrixAt(n++, this.m);
    }
    this.puffMesh.count = n;
    this.puffMesh.instanceMatrix.needsUpdate = true;
  }
}
