import * as THREE from "three";
import { BikeModel } from "./bike.ts";
import { ChaseCamera } from "./camera.ts";
import { CarLayer } from "./cars.ts";
import { buildCity, type CityParts } from "./city.ts";
import { Effects } from "./effects.ts";
import { Gearbox, type Shift } from "./gearbox.ts";
import { ObstacleLayer } from "./obstacles.ts";
import { forwardOf } from "./pose.ts";
import type { CityPlan, ScenePlayer, SceneQuake, SceneState } from "./types.ts";

const SKY = "#bfe3ff";

export type CameraMode = "chase" | "overview" | "showroom";

export function quakeShake(quake: SceneQuake | null, x: number, z: number): number {
  if (!quake || quake.radius <= 0) return 0;
  const near = 1.25 - Math.hypot(x - quake.x, z - quake.z) / quake.radius;
  return Math.max(0, Math.min(1, quake.magnitude / 10)) * Math.max(0, Math.min(1, near));
}

export class CityScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly city: CityParts;
  readonly view: ChaseCamera;
  private readonly cars = new CarLayer();
  private readonly bikes = new Map<number, BikeModel>();
  private readonly fx = new Effects();
  readonly obstacles: ObstacleLayer;
  private readonly trails = new Map<number, { rx: number; rz: number; speed: number; dust: number; smoke: number }>();
  private readonly sun: THREE.DirectionalLight;
  private readonly size: number;
  private readonly fog = new THREE.Fog(SKY, 160, 520);
  cameraMode: CameraMode = "chase";
  topSpeed = 15;
  readonly gearbox = new Gearbox();
  onShift: ((shift: Shift, gear: number) => void) | null = null;
  private selfSpeed = 0;
  private orbit = 0;

  constructor(canvas: HTMLCanvasElement, plan: CityPlan) {
    this.size = plan.world.size_m;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = this.fog;
    this.scene.add(new THREE.HemisphereLight("#dff1ff", "#6d8a4e", 1.6));

    this.sun = new THREE.DirectionalLight("#fff4e0", 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -70;
    s.right = 70;
    s.top = 70;
    s.bottom = -70;
    s.near = 1;
    s.far = 300;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    this.city = buildCity(plan);
    this.obstacles = new ObstacleLayer(plan);
    this.scene.add(this.city.group, this.cars.group, this.fx.group, this.obstacles.group);
    this.view = new ChaseCamera(canvas.clientWidth / Math.max(1, canvas.clientHeight));
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.view.resize(width / Math.max(1, height));
  }

  update(state: SceneState, dt: number): void {
    const seen = new Set<number>();
    for (const p of state.players) {
      seen.add(p.id);
      let bike = this.bikes.get(p.id);
      if (!bike || bike.team !== p.team || bike.tone !== p.tone) {
        if (bike) this.drop(p.id);
        bike = new BikeModel(p.team, p.tone);
        this.bikes.set(p.id, bike);
        this.scene.add(bike.root);
      }
      bike.update(p, dt);
      this.emit(p, dt);
    }
    for (const id of [...this.bikes.keys()]) if (!seen.has(id)) this.drop(id);
    this.cars.update(state.cars);
    this.obstacles.update(state.obstacles ?? []);
    this.fx.update(dt);

    const self = state.players.find((p) => p.id === state.self);
    if (self && dt > 0) this.shiftGears(self, dt);
    this.view.quakeTarget = self ? quakeShake(state.quake ?? null, self.x, self.z) : 0;
    this.scene.fog = this.cameraMode === "chase" ? this.fog : null;
    const focus = self ?? { x: this.size / 2, z: this.size / 2 };
    this.orbit += dt * 0.45;
    if (self && this.cameraMode === "chase") this.view.follow(self, dt);
    else if (self && this.cameraMode === "showroom") this.view.showroom(self, this.orbit, dt);
    else this.view.overview({ x: this.size / 2, z: this.size / 2 }, this.size, dt);

    this.sun.position.set(focus.x - 60, 120, focus.z + 40);
    this.sun.target.position.set(focus.x, 0, focus.z);
  }

  render(): void {
    this.renderer.render(this.scene, this.view.camera);
  }

  private shiftGears(self: ScenePlayer, dt: number): void {
    const accel = (self.speed - this.selfSpeed) / dt;
    this.selfSpeed = self.speed;
    const shift = self.fallen ? null : this.gearbox.update(self.speed, accel, this.topSpeed, dt);
    if (!shift) return;
    this.bikes.get(self.id)?.kick(shift);
    if (this.cameraMode === "chase") this.view.kick(shift);
    if (shift === "up") {
      const f = forwardOf(self.heading);
      for (let i = 0; i < 3; i++) this.fx.puff(self.x - f.x * 1.2 + f.z * 0.2, 0.5, self.z - f.z * 1.2 - f.x * 0.2, 0.16, 0.8, 1.3);
    }
    this.onShift?.(shift, this.gearbox.gear);
  }

  private emit(p: ScenePlayer, dt: number): void {
    const f = forwardOf(p.heading);
    const rx = p.x - f.x * 0.72;
    const rz = p.z - f.z * 0.72;
    const t = this.trails.get(p.id) ?? { rx, rz, speed: p.speed, dust: 0, smoke: 0 };
    const accel = (p.speed - t.speed) / Math.max(dt, 1e-4);
    const hardBrake = accel < -6 && p.speed > 2.5;
    if (!p.fallen && (p.sliding || hardBrake)) this.fx.skid(t.rx, t.rz, rx, rz);
    t.dust += dt;
    if (!p.fallen && p.sliding && t.dust > 0.045) {
      t.dust = 0;
      this.fx.puff(rx, 0.25, rz, 0.55, 2.2, 1.1);
    }
    t.smoke += dt;
    if (!p.fallen && accel > 1.5 && Math.abs(p.speed) < 7 && t.smoke > 0.12) {
      t.smoke = 0;
      this.fx.puff(rx + f.z * 0.18 - f.x * 0.5, 0.5, rz - f.x * 0.18 - f.z * 0.5, 0.13, 0.5, 1.6);
    }
    t.rx = rx;
    t.rz = rz;
    t.speed = p.speed;
    this.trails.set(p.id, t);
  }

  private drop(id: number): void {
    this.trails.delete(id);
    const bike = this.bikes.get(id);
    if (!bike) return;
    this.scene.remove(bike.root);
    bike.dispose();
    this.bikes.delete(id);
  }
}
