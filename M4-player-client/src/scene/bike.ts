import * as THREE from "three";
import { damp, dampAngle, Spring, wrapAngle } from "./motion.ts";
import { playerColor, yawOf } from "./pose.ts";
import { buildScooter, FRONT_AXLE, HIPS, NECK, REAR_AXLE, STEER_HEAD, WHEEL_R, WHEELBASE, type ScooterGeometry } from "./scooter.ts";
import { scooterTemplate, TEAM_PAINT } from "./scooter-model.ts";
import type { ScenePlayer } from "./types.ts";

const FALLEN_ROLL = 1.36;
const LEAN_SHARE = 0.55;
const LEAN_MAX = 0.42;
const TAIL_OFF = new THREE.Color("#6e1010");
const TAIL_ON = new THREE.Color("#ff3b30");

const LIT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
const shapes = new Map<string, ScooterGeometry>();
const paints = new Map<string, THREE.Material>();

function paintFor(color: string, base: THREE.Material): THREE.Material {
  let m = paints.get(color);
  if (!m) {
    m = base.clone();
    if (m instanceof THREE.MeshStandardMaterial) m.color.set(color);
    paints.set(color, m);
  }
  return m;
}

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
  readonly team: number;
  readonly tone: number;
  readonly fromFile: boolean;
  body!: THREE.Object3D;
  private chassis!: THREE.Object3D;
  private fork!: THREE.Object3D;
  private rider!: THREE.Object3D;
  private head!: THREE.Object3D;
  private front!: THREE.Object3D;
  private rear!: THREE.Object3D;
  private tail!: THREE.Material;

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
  private ground = 0;

  constructor(team: number, tone = 0) {
    this.team = team;
    this.tone = tone;
    this.root.name = "bike";
    const color = playerColor(team, tone);
    const model = scooterTemplate();
    this.fromFile = model !== null;
    if (model) this.useModel(model, color);
    else this.buildParts(color);
  }

  private useModel(model: THREE.Object3D, color: string): void {
    const copy = model.clone(true);
    copy.position.set(0, 0, 0);
    copy.rotation.set(0, 0, 0);
    this.root.add(copy);
    const node = (name: string) => copy.getObjectByName(name)!;
    this.body = node("Body");
    this.chassis = node("Chassis");
    this.fork = node("Fork");
    this.rider = node("Rider");
    this.head = node("Head");
    this.front = node("FrontWheel");
    this.rear = node("RearWheel");
    copy.traverse((o) => {
      if (o instanceof THREE.Mesh && !Array.isArray(o.material) && o.material.name === TEAM_PAINT) o.material = paintFor(color, o.material);
    });
    const tailNode = node("TailLight");
    const tailMesh = (tailNode instanceof THREE.Mesh ? tailNode : tailNode.getObjectByProperty("isMesh", true)) as THREE.Mesh | undefined;
    this.tail = tailMesh ? (tailMesh.material as THREE.Material).clone() : new THREE.MeshBasicMaterial();
    if (tailMesh) tailMesh.material = this.tail;
  }

  private buildParts(color: string): void {
    const g = scooterFor(color);
    const body = new THREE.Group();
    const chassis = new THREE.Group();
    const fork = new THREE.Group();
    const rider = new THREE.Group();
    const head = new THREE.Group();
    this.body = body;
    this.chassis = chassis;
    this.fork = fork;
    this.rider = rider;
    this.head = head;
    this.tail = new THREE.MeshBasicMaterial({ color: TAIL_OFF.clone() });
    this.root.add(body);
    body.add(chassis);
    chassis.position.copy(REAR_AXLE);

    this.rear = mesh(g.rearWheel, LIT);
    chassis.add(mesh(g.frame, LIT), mesh(g.frameLights, GLOW, false), mesh(g.tail, this.tail, false), this.rear);

    fork.position.copy(STEER_HEAD).sub(REAR_AXLE);
    this.front = mesh(g.frontWheel, LIT);
    this.front.position.copy(FRONT_AXLE).sub(STEER_HEAD);
    fork.add(mesh(g.fork, LIT), mesh(g.forkLights, GLOW, false), this.front);
    chassis.add(fork);

    rider.position.copy(HIPS).sub(REAR_AXLE);
    head.position.copy(NECK).sub(HIPS);
    head.add(mesh(g.head, LIT));
    rider.add(mesh(g.rider, LIT), head);
    chassis.add(rider);
  }

  update(p: ScenePlayer, dt: number, ground = 0): void {
    const yaw = yawOf(p.heading);
    if (!this.started) {
      this.started = true;
      this.yaw = yaw;
      this.lastHeading = yaw;
      this.lastSpeed = p.speed;
      this.roll.snap(p.fallen ? FALLEN_ROLL : -shownLean(p.lean));
      this.ground = ground;
    }
    const step = Math.max(dt, 1e-4);

    this.ground = damp(this.ground, ground, 25, dt);
    this.root.position.set(p.x, this.ground, p.z);
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
      this.steer.step(Math.max(-0.6, Math.min(0.6, wheelAngle * 1.7 * Math.sign(p.speed || 1))), dt);
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
    const surge = Math.max(-0.14, Math.min(0.1, this.accel * 0.025));
    const look = Math.max(-0.7, Math.min(0.7, this.steer.value * 0.9 + this.yawRate * 0.25));
    this.rider.rotation.set(-fast * 0.3 + surge - this.nod.value * 0.12, this.steer.value * 0.35, this.roll.value * 0.3);
    this.head.rotation.set(fast * 0.22 - surge * 0.5 + this.nod.value * 0.06, look, -this.roll.value * 0.35);

    this.braking = damp(this.braking, this.accel < -2.5 ? 1 : 0, 14, dt);
    if (this.tail instanceof THREE.MeshStandardMaterial) this.tail.emissiveIntensity = 0.6 + this.braking * 2.6;
    else if (this.tail instanceof THREE.MeshBasicMaterial) this.tail.color.copy(TAIL_OFF).lerp(TAIL_ON, this.braking);
  }

  kick(shift: "up" | "down"): void {
    this.pitch.velocity += shift === "up" ? -0.3 : 0.2;
    this.nod.velocity += shift === "up" ? 0.6 : -0.4;
  }

  dispose(): void {
    this.tail.dispose();
  }
}
