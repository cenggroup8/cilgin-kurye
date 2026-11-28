import * as THREE from "three";
import { hash } from "./city.ts";
import { yawOf } from "./pose.ts";
import type { SceneCar } from "./types.ts";

const PAINT = ["#e4e6ea", "#b7bec9", "#5d6878", "#d0533f", "#3f6fb5", "#e0b546", "#2e333b", "#5c9a7f", "#f08a4b"];

export class CarLayer {
  readonly group = new THREE.Group();
  private readonly body: THREE.InstancedMesh;
  private readonly cabin: THREE.InstancedMesh;
  private readonly lights: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly color = new THREE.Color();
  readonly capacity: number;

  constructor(capacity = 64) {
    this.capacity = capacity;
    const mat = () => new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.6 });
    this.body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(), capacity);
    this.cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#24303d", roughness: 0.3, metalness: 0.2 }), capacity);
    this.lights = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: "#fff3c4", emissive: "#ffe9a8", emissiveIntensity: 0.9 }),
      capacity,
    );
    for (const mesh of [this.body, this.cabin, this.lights]) {
      mesh.castShadow = true;
      mesh.count = 0;
      mesh.frustumCulled = false;
    }
    this.body.name = "car-bodies";
    this.group.add(this.body, this.cabin, this.lights);
  }

  private place(mesh: THREE.InstancedMesh, i: number, car: SceneCar, along: number, y: number, sx: number, sy: number, sz: number): void {
    const yaw = yawOf(car.heading);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    this.q.setFromAxisAngle(this.up, yaw);
    this.m.compose(new THREE.Vector3(car.x + fx * along, y, car.z + fz * along), this.q, new THREE.Vector3(sx, sy, sz));
    mesh.setMatrixAt(i, this.m);
  }

  update(cars: readonly SceneCar[]): void {
    const n = Math.min(cars.length, this.capacity);
    for (let i = 0; i < n; i++) {
      const c = cars[i];
      const L = c.length;
      const W = c.width;
      this.place(this.body, i, c, 0, 0.62, W, 0.8, L);
      this.place(this.cabin, i, c, -0.08 * L, 1.32, W * 0.84, 0.62, L * 0.48);
      this.place(this.lights, i, c, L / 2, 0.7, W * 0.8, 0.16, 0.06);
      this.color.set(c.offroad ? "#7b8089" : PAINT[Math.floor(hash(c.id, 11) * PAINT.length)]);
      this.body.setColorAt(i, this.color);
    }
    for (const mesh of [this.body, this.cabin, this.lights]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
}
