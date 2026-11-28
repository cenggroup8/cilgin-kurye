import * as THREE from "three";
import { Spring } from "./motion.ts";
import { forwardOf, smoothing } from "./pose.ts";

export interface Follow {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

export function chaseSpot(t: Follow): { eye: THREE.Vector3; look: THREE.Vector3 } {
  const f = forwardOf(t.heading);
  const back = 6.2 + Math.min(Math.abs(t.speed), 20) * 0.16;
  const height = 2.9 + Math.min(Math.abs(t.speed), 20) * 0.045;
  return {
    eye: new THREE.Vector3(t.x - f.x * back, height, t.z - f.z * back),
    look: new THREE.Vector3(t.x + f.x * 5, 1.2, t.z + f.z * 5),
  };
}

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly look = new THREE.Vector3();
  private readonly base = new THREE.Vector3();
  private readonly push = new Spring(0, 2.2, 0.45);
  private placed = false;
  private fov = 60;
  private quake = 0;
  private clock = 0;
  quakeTarget = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.3, 1600);
  }

  follow(target: Follow, dt: number): void {
    const spot = chaseSpot(target);
    if (!this.placed) {
      this.base.copy(spot.eye);
      this.look.copy(spot.look);
      this.placed = true;
    } else {
      this.base.lerp(spot.eye, smoothing(5, dt));
      this.look.lerp(spot.look, smoothing(8, dt));
    }
    const f = forwardOf(target.heading);
    const shake = this.push.step(0, dt);
    this.clock += dt;
    this.quake += (this.quakeTarget - this.quake) * smoothing(this.quakeTarget > this.quake ? 6 : 2, dt);
    const q = this.quake;
    const t = this.clock;
    const jx = (Math.sin(t * 23.3) * 0.6 + Math.sin(t * 37.1 + 1.3) * 0.4) * 0.32 * q;
    const jy = (Math.sin(t * 29.7 + 0.4) * 0.6 + Math.sin(t * 43.9) * 0.4) * 0.18 * q;
    const jz = (Math.sin(t * 19.1 + 2.1) * 0.6 + Math.sin(t * 31.3 + 0.7) * 0.4) * 0.32 * q;
    this.camera.position.set(this.base.x - f.x * shake + jx, this.base.y + jy, this.base.z - f.z * shake + jz);
    this.camera.lookAt(this.look.x + jx * 0.4, this.look.y + jy * 0.4, this.look.z + jz * 0.4);
    this.camera.rotateZ((Math.sin(t * 17.3) * 0.6 + Math.sin(t * 27.9 + 0.9) * 0.4) * 0.025 * q);
    this.setFov(60 + Math.min(Math.abs(target.speed), 22) * 0.28 + shake * 2.5, dt);
  }

  kick(shift: "up" | "down"): void {
    this.push.velocity += shift === "up" ? 2.6 : -1.2;
  }

  private setFov(target: number, dt: number): void {
    this.fov += (target - this.fov) * smoothing(6, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  showroom(target: Follow, angle: number, dt: number): void {
    const eye = new THREE.Vector3(target.x + Math.sin(angle) * 3.4, 1.45, target.z + Math.cos(angle) * 3.4);
    this.base.lerp(eye, smoothing(4, dt));
    this.camera.position.copy(this.base);
    this.look.lerp(new THREE.Vector3(target.x, 0.75, target.z), smoothing(6, dt));
    this.camera.lookAt(this.look);
    this.setFov(50, dt);
  }

  overview(centre: { x: number; z: number }, size: number, dt: number): void {
    const eye = new THREE.Vector3(centre.x + size * 0.1, size * 0.72, centre.z + size * 0.62);
    this.base.lerp(eye, smoothing(3, dt));
    this.camera.position.copy(this.base);
    this.look.lerp(new THREE.Vector3(centre.x, 0, centre.z), smoothing(3, dt));
    this.camera.lookAt(this.look);
    this.setFov(60, dt);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
