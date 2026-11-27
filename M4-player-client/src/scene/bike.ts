import * as THREE from "three";
import { damp, dampAngle, Spring, wrapAngle } from "./motion.ts";
import { teamColor, yawOf } from "./pose.ts";
import type { ScenePlayer } from "./types.ts";

const FALLEN_ROLL = 1.38;
const WHEEL_R = 0.33;
const WHEELBASE = 1.44;

function mat(color: string, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.65, ...extra });
}

function part(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function wheel(): THREE.Group {
  const g = new THREE.Group();
  const tyre = part(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.15, 14).rotateZ(Math.PI / 2), mat("#1b1d22", { roughness: 0.95 }), 0, 0, 0);
  const rim = part(new THREE.CylinderGeometry(0.19, 0.19, 0.17, 6).rotateZ(Math.PI / 2), mat("#aab2bf", { metalness: 0.3 }), 0, 0, 0);
  const spoke = part(new THREE.BoxGeometry(0.18, 0.05, 0.34), mat("#6b7380"), 0, 0, 0);
  g.add(tyre, rim, spoke);
  return g;
}

export class BikeModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly team: number;
  private readonly chassis = new THREE.Group();
  private readonly fork = new THREE.Group();
  private readonly rider = new THREE.Group();
  private readonly torso: THREE.Mesh;
  private readonly head: THREE.Group;
  private readonly front: THREE.Group;
  private readonly rear: THREE.Group;
  private readonly tail: THREE.MeshStandardMaterial;

  private readonly roll = new Spring(0, 2.4, 0.72);
  private readonly pitch = new Spring(0, 2.1, 0.42);
  private readonly steer = new Spring(0, 3.2, 0.85);
  private yaw = 0;
  private spin = 0;
  private lastSpeed = 0;
  private accel = 0;
  private yawRate = 0;
  private lastHeading = 0;
  private fallSide = 1;
  private time = 0;
  private started = false;

  constructor(team: number) {
    this.team = team;
    this.root.name = "bike";
    const color = teamColor(team);
    const paint = mat(color, { roughness: 0.45 });
    const dark = mat("#24272e");
    const steel = mat("#9aa2ae", { metalness: 0.35, roughness: 0.4 });

    this.root.add(this.body);
    this.body.add(this.chassis);
    this.chassis.position.set(0, WHEEL_R, WHEELBASE / 2);

    this.rear = wheel();
    this.chassis.add(this.rear);

    const frame = new THREE.Group();
    frame.position.set(0, 0, -WHEELBASE / 2);
    frame.add(
      part(new THREE.BoxGeometry(0.34, 0.3, 1.1), paint, 0, 0.3, 0.02),
      part(new THREE.BoxGeometry(0.38, 0.22, 0.46), paint, 0, 0.5, -0.22),
      part(new THREE.BoxGeometry(0.3, 0.12, 0.6), dark, 0, 0.56, 0.24),
      part(new THREE.BoxGeometry(0.16, 0.12, 0.5), steel, 0.2, 0.12, 0.42),
    );
    this.tail = mat("#5a1010", { emissive: "#ff2a2a", emissiveIntensity: 0.15 });
    frame.add(part(new THREE.BoxGeometry(0.22, 0.09, 0.05), this.tail, 0, 0.5, 0.6));
    const parcel = part(new THREE.BoxGeometry(0.58, 0.46, 0.54), mat("#c8955b"), 0, 0.86, 0.46);
    const tape = part(new THREE.BoxGeometry(0.6, 0.08, 0.56), mat("#ecd6a8"), 0, 0.95, 0.46);
    const tapeSide = part(new THREE.BoxGeometry(0.08, 0.48, 0.56), mat("#ecd6a8"), 0, 0.86, 0.46);
    frame.add(parcel, tape, tapeSide);
    this.chassis.add(frame);

    this.fork.position.set(0, 0, -WHEELBASE);
    this.front = wheel();
    this.fork.add(this.front);
    this.fork.add(
      part(new THREE.BoxGeometry(0.06, 0.62, 0.06).rotateX(-0.32), steel, -0.11, 0.3, 0.1),
      part(new THREE.BoxGeometry(0.06, 0.62, 0.06).rotateX(-0.32), steel, 0.11, 0.3, 0.1),
      part(new THREE.BoxGeometry(0.74, 0.06, 0.06), dark, 0, 0.66, 0.2),
      part(new THREE.BoxGeometry(0.3, 0.2, 0.12), paint, 0, 0.55, 0.06),
    );
    const lamp = part(
      new THREE.BoxGeometry(0.18, 0.13, 0.05),
      new THREE.MeshStandardMaterial({ color: "#fff6d8", emissive: "#fff1b8", emissiveIntensity: 1.4 }),
      0,
      0.55,
      -0.01,
    );
    this.fork.add(lamp);
    this.chassis.add(this.fork);

    this.rider.position.set(0, 0.62, -WHEELBASE / 2 + 0.16);
    this.torso = part(new THREE.BoxGeometry(0.44, 0.6, 0.3), paint, 0, 0.36, 0);
    const legs = new THREE.Group();
    legs.add(
      part(new THREE.BoxGeometry(0.13, 0.14, 0.46), mat("#2f3540"), -0.2, 0.04, -0.12),
      part(new THREE.BoxGeometry(0.13, 0.14, 0.46), mat("#2f3540"), 0.2, 0.04, -0.12),
      part(new THREE.BoxGeometry(0.12, 0.4, 0.13), mat("#2f3540"), -0.22, -0.18, -0.34),
      part(new THREE.BoxGeometry(0.12, 0.4, 0.13), mat("#2f3540"), 0.22, -0.18, -0.34),
    );
    this.head = new THREE.Group();
    this.head.position.set(0, 0.8, -0.12);
    this.head.add(
      part(new THREE.IcosahedronGeometry(0.2, 1), mat("#f7f7f7", { roughness: 0.3 }), 0, 0, 0),
      part(new THREE.BoxGeometry(0.28, 0.1, 0.08), mat("#1b1d22", { roughness: 0.2 }), 0, 0.0, -0.17),
      part(new THREE.BoxGeometry(0.06, 0.2, 0.36), paint, 0, 0.14, 0.02),
    );
    const arms = new THREE.Group();
    arms.add(
      part(new THREE.BoxGeometry(0.1, 0.1, 0.56).rotateX(0.5), paint, -0.27, 0.42, -0.32),
      part(new THREE.BoxGeometry(0.1, 0.1, 0.56).rotateX(0.5), paint, 0.27, 0.42, -0.32),
    );
    this.rider.add(this.torso, legs, this.head, arms);
    this.chassis.add(this.rider);
  }

  update(p: ScenePlayer, dt: number): void {
    const yaw = yawOf(p.heading);
    if (!this.started) {
      this.started = true;
      this.yaw = yaw;
      this.lastHeading = yaw;
      this.lastSpeed = p.speed;
      this.roll.snap(p.fallen ? FALLEN_ROLL : -p.lean);
    }
    const step = Math.max(dt, 1e-4);
    this.time += dt;

    this.root.position.set(p.x, 0, p.z);
    this.yaw = dampAngle(this.yaw, yaw, 30, dt);
    this.root.rotation.y = this.yaw;

    const rate = wrapAngle(yaw - this.lastHeading) / step;
    this.lastHeading = yaw;
    this.yawRate = damp(this.yawRate, rate, 10, dt);
    this.accel = damp(this.accel, (p.speed - this.lastSpeed) / step, 8, dt);
    this.lastSpeed = p.speed;

    if (p.fallen) {
      if (Math.abs(this.roll.value) < 0.4) this.fallSide = this.roll.value >= 0 ? 1 : -1;
      this.roll.step(this.fallSide * FALLEN_ROLL, dt);
      this.pitch.step(0, dt);
      this.steer.step(0, dt);
    } else {
      this.roll.step(-p.lean, dt);
      const speed = Math.abs(p.speed);
      const wheelAngle = speed > 0.3 ? Math.atan((this.yawRate * WHEELBASE) / speed) : 0;
      this.steer.step(Math.max(-0.6, Math.min(0.6, wheelAngle * Math.sign(p.speed || 1))), dt);
      this.pitch.step(Math.max(-0.09, Math.min(0.07, this.accel * 0.012)), dt);
      this.spin += (p.speed / WHEEL_R) * dt;
    }

    this.body.rotation.z = this.roll.value;
    this.body.position.y = Math.min(1, Math.abs(this.roll.value) / FALLEN_ROLL) * 0.3;
    this.chassis.rotation.x = this.pitch.value;
    this.fork.rotation.y = this.steer.value;
    this.front.rotation.x = -this.spin;
    this.rear.rotation.x = -this.spin;

    const fast = Math.min(1, Math.abs(p.speed) / 14);
    this.rider.rotation.z = this.roll.value * 0.18;
    this.torso.rotation.x = -0.3 - fast * 0.35;
    this.head.position.z = -0.12 - fast * 0.18;
    this.head.position.y = 0.8 - fast * 0.08 + Math.sin(this.time * 11) * 0.008 * fast;
    this.head.rotation.y = this.steer.value * 0.6;
    this.tail.emissiveIntensity = damp(this.tail.emissiveIntensity, this.accel < -2.5 ? 2.4 : 0.15, 14, dt);
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
