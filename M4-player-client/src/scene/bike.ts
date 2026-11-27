import * as THREE from "three";
import { damp, dampAngle, Spring, wrapAngle } from "./motion.ts";
import { playerColor, yawOf } from "./pose.ts";
import { buildScooter, FRONT_AXLE, HIPS, NECK, REAR_AXLE, STEER_HEAD, WHEEL_R, WHEELBASE, type ScooterGeometry } from "./scooter.ts";
import type { ScenePlayer } from "./types.ts";

const FALLEN_ROLL = 1.36;
const LEAN_SHARE = 0.55;
const LEAN_MAX = 0.42;
const TAIL_OFF = new THREE.Color("#6e1010");
const TAIL_ON = new THREE.Color("#ff3b30");

const LIT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
const shapes = new Map<string, ScooterGeometry>();

function scooterFor(color: string): ScooterGeometry {
  let g = shapes.get(color);
  if (!g) {
    g = buildScooter(color);
    shapes.set(color, g);
  }
  return g;
}

export function shownLean(lean: number): number {
  return Math.max(-LEAN_MAX, Math.min(LEAN_MAX, lean * LEAN_SHARE));
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = shadow;
  return m;
}

export class BikeModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly team: number;
  readonly tone: number;
  private readonly chassis = new THREE.Group();
  private readonly fork = new THREE.Group();
  private readonly rider = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly front: THREE.Mesh;
  private readonly rear: THREE.Mesh;
  private readonly tail = new THREE.MeshBasicMaterial({ color: TAIL_OFF.clone() });

  private readonly roll = new Spring(0, 2.4, 0.72);
  private readonly pitch = new Spring(0, 2.1, 0.42);
  private readonly steer = new Spring(0, 3.2, 0.85);
  private readonly nod = new Spring(0, 2.2, 0.6);
  private yaw = 0;
  private spin = 0;
  private lastSpeed = 0;
  private accel = 0;
  private yawRate = 0;
  private lastHeading = 0;
  private fallSide = 1;
  private braking = 0;
  private started = false;

  constructor(team: number, tone = 0) {
    this.team = team;
    this.tone = tone;
    this.root.name = "bike";
    const g = scooterFor(playerColor(team, tone));
    this.root.add(this.body);
    this.body.add(this.chassis);
    this.chassis.position.copy(REAR_AXLE);

    this.rear = mesh(g.rearWheel, LIT);
    this.chassis.add(mesh(g.frame, LIT), mesh(g.frameLights, GLOW, false), mesh(g.tail, this.tail, false), this.rear);

    this.fork.position.copy(STEER_HEAD).sub(REAR_AXLE);
    this.front = mesh(g.frontWheel, LIT);
    this.front.position.copy(FRONT_AXLE).sub(STEER_HEAD);
    this.fork.add(mesh(g.fork, LIT), mesh(g.forkLights, GLOW, false), this.front);
    this.chassis.add(this.fork);

    this.rider.position.copy(HIPS).sub(REAR_AXLE);
    this.head.position.copy(NECK).sub(HIPS);
    this.head.add(mesh(g.head, LIT));
    this.rider.add(mesh(g.rider, LIT), this.head);
    this.chassis.add(this.rider);
  }

  update(p: ScenePlayer, dt: number): void {
    const yaw = yawOf(p.heading);
    if (!this.started) {
      this.started = true;
      this.yaw = yaw;
      this.lastHeading = yaw;
      this.lastSpeed = p.speed;
      this.roll.snap(p.fallen ? FALLEN_ROLL : -shownLean(p.lean));
    }
    const step = Math.max(dt, 1e-4);

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
      this.roll.step(-shownLean(p.lean), dt);
      const speed = Math.abs(p.speed);
      const wheelAngle = speed > 0.3 ? Math.atan((this.yawRate * WHEELBASE) / speed) : 0;
      this.steer.step(Math.max(-0.55, Math.min(0.55, wheelAngle * Math.sign(p.speed || 1))), dt);
      this.pitch.step(Math.max(-0.07, Math.min(0.05, this.accel * 0.01)), dt);
      this.spin += (p.speed / WHEEL_R) * dt;
    }
    this.nod.step(0, dt);

    this.body.rotation.z = this.roll.value;
    this.body.position.y = Math.min(1, Math.abs(this.roll.value) / FALLEN_ROLL) * 0.26;
    this.chassis.rotation.x = this.pitch.value;
    this.fork.rotation.y = this.steer.value;
    this.front.rotation.x = -this.spin;
    this.rear.rotation.x = -this.spin;

    const fast = Math.min(1, Math.abs(p.speed) / 14);
    this.rider.rotation.set(-fast * 0.14 - this.nod.value * 0.12, this.steer.value * 0.2, this.roll.value * 0.12);
    this.head.rotation.set(fast * 0.12 + this.nod.value * 0.06, this.steer.value * 0.5, 0);

    this.braking = damp(this.braking, this.accel < -2.5 ? 1 : 0, 14, dt);
    this.tail.color.copy(TAIL_OFF).lerp(TAIL_ON, this.braking);
  }

  kick(shift: "up" | "down"): void {
    this.pitch.velocity += shift === "up" ? -0.3 : 0.2;
    this.nod.velocity += shift === "up" ? 0.6 : -0.4;
  }

  dispose(): void {
    this.tail.dispose();
  }
}
