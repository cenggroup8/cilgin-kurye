import * as THREE from "three";
import { forwardOf, smoothing } from "./pose.ts";

export interface Follow {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

export function chaseSpot(t: Follow): { eye: THREE.Vector3; look: THREE.Vector3 } {
  const f = forwardOf(t.heading);
  const back = 7 + Math.min(Math.abs(t.speed), 20) * 0.18;
  const height = 3.2 + Math.min(Math.abs(t.speed), 20) * 0.05;
  return {
    eye: new THREE.Vector3(t.x - f.x * back, height, t.z - f.z * back),
    look: new THREE.Vector3(t.x + f.x * 5, 1.2, t.z + f.z * 5),
  };
}

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly look = new THREE.Vector3();
  private placed = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.3, 1600);
  }

  follow(target: Follow, dt: number): void {
    const spot = chaseSpot(target);
    if (!this.placed) {
      this.camera.position.copy(spot.eye);
      this.look.copy(spot.look);
      this.placed = true;
    } else {
      this.camera.position.lerp(spot.eye, smoothing(5, dt));
      this.look.lerp(spot.look, smoothing(8, dt));
    }
    this.camera.lookAt(this.look);
  }

  overview(centre: { x: number; z: number }, size: number, dt: number): void {
    const eye = new THREE.Vector3(centre.x + size * 0.1, size * 0.72, centre.z + size * 0.62);
    this.camera.position.lerp(eye, smoothing(3, dt));
    this.look.lerp(new THREE.Vector3(centre.x, 0, centre.z), smoothing(3, dt));
    this.camera.lookAt(this.look);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
