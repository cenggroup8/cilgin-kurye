import "./ui.css";
import {
  blendCar,
  blendPlayer,
  CityScene,
  EngineAudio,
  FrameRate,
  loadScooter,
  PLAYER_TONES,
  SnapshotBuffer,
  TEAM_NAMES,
  type CameraMode,
  type CityPlan,
  type SceneCar,
  type SceneObstacle,
  type ScenePlayer,
  type SceneQuake,
} from "../src/scene/index.ts";
import { FakeM1 } from "@m3/test/fakes/fakeM1.ts";
import { m3City } from "@m3/test/fakes/cityPlan.ts";
import { fromContractHeading, fromContractPoint, toContractHeading, toContractPoint } from "@m3/src/common/coords.ts";
import { fromContractObstacles } from "@m3/src/traffic/npc/contract.ts";

const planResponse = await fetch("./city_plan.json");
if (!planResponse.ok) throw new Error(await planResponse.text());
const plan = (await planResponse.json()) as CityPlan;

const PLAYER = 0;
const NORTH = Math.PI / 2;
const STEER_IN = 2.4;
const STEER_SWAP = 6;
const STEER_OUT = 6.5;
const PEDAL_IN = 7;
const PEDAL_OUT = 12;
const PENALTY_TICKS = 90;
const RIVALS = [
  { team: 1, tone: 0 },
  { team: 2, tone: 1 },
  { team: 3, tone: 0 },
];
const DEMO_OBSTACLES: SceneObstacle[] = [
  { id: 1, type: "puddle", segment: 0, lane: 1, pos: 0.55 },
  { id: 2, type: "accident", segment: 0, lane: 3, pos: 0.82 },
  { id: 3, type: "road_work", segment: 31, lane: 0, pos: 0.5 },
  { id: 4, type: "heavy_traffic", segment: 1, lane: 0, pos: 0.5 },
];
const QUAKE: SceneQuake = { x: 250, z: 250, radius: 140, magnitude: 7 };

const ALIAS: Record<string, string> = { arrowleft: "a", arrowright: "d", arrowup: "w", arrowdown: "s" };
const held = new Set<string>();
const isHeld = (...keys: string[]) => keys.some((k) => held.has(k));
const input = { steer: 0, throttle: 0, brake: 0 };

type Pose = { x: number; y: number; heading: number };
type Car = { id: number; x: number; y: number; heading: number; speed: number; length: number; width: number; state: string };
let m1: FakeM1;
let prevBike: Pose;
let prevCars = new Map<number, Pose>();
let cars: Car[] = [];
let paused = false;
let showCars = true;
let obstaclesOn = true;
let quakeOn = false;
let standUpAt: number | null = null;
const carFeed = new SnapshotBuffer<SceneCar>(blendCar);
const rivalFeed = new SnapshotBuffer<ScenePlayer>(blendPlayer);

const towards = (v: number, target: number, step: number) => (Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step);

function readInput(dt: number): void {
  const target = (isHeld("arrowright", "d") ? 1 : 0) - (isHeld("arrowleft", "a") ? 1 : 0);
  const rate = target === 0 ? STEER_OUT : Math.sign(target) !== Math.sign(input.steer) && input.steer !== 0 ? STEER_SWAP : STEER_IN;
  input.steer = towards(input.steer, target, rate * dt);
  const gas = isHeld("arrowup", "w") ? 1 : 0;
  const brake = isHeld("arrowdown", "s") ? 1 : 0;
  input.throttle = towards(input.throttle, gas, (gas ? PEDAL_IN : PEDAL_OUT) * dt);
  input.brake = towards(input.brake, brake, (brake ? PEDAL_IN : PEDAL_OUT) * dt);
}

function reset(): void {
  input.steer = input.throttle = input.brake = 0;
  m1 = new FakeM1({
    seed: 7,
    players: [PLAYER],
    npcCars: 30,
    control: () => ({ throttle: input.throttle, brake: input.brake, steer: input.steer }),
  }, undefined, m3City(plan as unknown as Parameters<typeof m3City>[0]));
  const b = m1.physics.bikes.get(PLAYER)!;
  b.heading = NORTH;
  const spawn = new URLSearchParams(location.search).get("spawn")?.split(",").map(Number);
  if (spawn && spawn.length === 3 && spawn.every(Number.isFinite)) {
    const p = fromContractPoint(spawn[0], spawn[1]);
    b.x = p.x;
    b.y = p.y;
    b.heading = fromContractHeading(spawn[2]);
  }
  prevBike = { x: b.x, y: b.y, heading: b.heading };
  prevCars = new Map();
  cars = [];
  standUpAt = null;
  carFeed.clear();
  rivalFeed.clear();
  applyWorld();
}

function applyWorld(): void {
  if (!m1) return;
  const events = (m1.scenario.events ??= []);
  events.push({
    at: m1.tick,
    obstacles: obstaclesOn ? fromContractObstacles(DEMO_OBSTACLES, m1.city.graph) : [],
    quake: quakeOn ? { x: QUAKE.x, y: -QUAKE.z, radius: QUAKE.radius, strength: QUAKE.magnitude } : null,
  });
}
reset();

const canvas = document.getElementById("view") as HTMLCanvasElement;
const scene = new CityScene(canvas, plan);
const $ = (id: string) => document.getElementById(id)!;
const kmh = $("kmh");
const fpsText = $("fps");
const gearText = $("gear");
const soundBtn = $("sound");
const fullBtn = $("full");
const hint = $("hint");
const audio = new EngineAudio();
audio.useSample("./sounds/engine-loop.wav");
audio.useSqueal("./sounds/tyre-squeal.wav");
audio.start();

scene.onShift = (_shift, gear) => {
  gearText.textContent = String(gear);
  gearText.classList.remove("bump");
  void gearText.offsetWidth;
  gearText.classList.add("bump");
  audio.shift();
};

const wake = () => audio.start();
for (const type of ["pointerdown", "touchstart", "touchend", "keydown", "click"]) window.addEventListener(type, wake, { capture: true });
soundBtn.addEventListener("click", () => {
  audio.start();
  audio.setMuted(!audio.isMuted);
  soundBtn.classList.toggle("on", !audio.isMuted);
});

type FullDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null };
type FullEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
const doc = document as FullDoc;
const standalone =
  window.matchMedia("(display-mode: fullscreen)").matches ||
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
if (standalone) fullBtn.style.display = "none";
let hintTimer = 0;
fullBtn.addEventListener("click", async () => {
  const el = document.documentElement as FullEl;
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    await document.exitFullscreen?.().catch(() => undefined);
    return;
  }
  if (doc.fullscreenEnabled && el.requestFullscreen) {
    await el.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.("landscape").catch(() => undefined);
  } else if (doc.webkitFullscreenEnabled && el.webkitRequestFullscreen) {
    await el.webkitRequestFullscreen();
  } else {
    hint.classList.add("show");
    clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => hint.classList.remove("show"), 5000);
  }
});
document.addEventListener("fullscreenchange", () => fullBtn.classList.toggle("on", !!doc.fullscreenElement));
const pausedEl = $("paused");
if (new URLSearchParams(location.search).has("bike")) scene.cameraMode = "showroom";
const holdButtons = [...document.querySelectorAll<HTMLElement>("[data-hold]")];
const toolButtons = new Map([...document.querySelectorAll<HTMLElement>("[data-key]")].map((b) => [b.dataset.key!, b]));

function resize(): void {
  scene.resize(canvas.clientWidth, canvas.clientHeight);
}
new ResizeObserver(resize).observe(canvas);
window.visualViewport?.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 200));
resize();

const stop = (e: Event) => e.preventDefault();
for (const type of ["gesturestart", "gesturechange", "gestureend", "dblclick"]) document.addEventListener(type, stop, { passive: false });
document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener("touchend", (e) => {
  const now = performance.now();
  if (now - lastTouchEnd < 350) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

function toggle(k: string): void {
  if (k === "c") scene.cameraMode = scene.cameraMode === "chase" ? "overview" : "chase";
  if (k === "v") scene.cameraMode = scene.cameraMode === "showroom" ? "chase" : "showroom";
  if (k === "n") showCars = !showCars;
  if (k === "r") {
    reset();
    scene.gearbox.gear = 1;
    gearText.textContent = "1";
  }
  if (k === "p") paused = !paused;
  if (k === "o") toggleObstacles();
  if (k === "q") toggleQuake();
}

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k.startsWith("arrow") || k === " ") e.preventDefault();
  held.add(k);
  if (!e.repeat) toggle(k);
});
window.addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => held.clear());

const pointerKeys = new Map<number, string>();
for (const b of holdButtons) {
  const key = b.dataset.hold!;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    pointerKeys.set(e.pointerId, key);
    held.add(key);
  });
  const release = (e: PointerEvent) => {
    if (pointerKeys.get(e.pointerId) !== key) return;
    pointerKeys.delete(e.pointerId);
    if (![...pointerKeys.values()].includes(key)) held.delete(key);
  };
  b.addEventListener("pointerup", release);
  b.addEventListener("pointercancel", release);
}
for (const [key, b] of toolButtons) b.addEventListener("click", () => toggle(key));
const livery = { team: Math.floor(PLAYER / 2), tone: PLAYER % 2 };
const liveries = $("liveries");
PLAYER_TONES.forEach((tones, team) => {
  const name = document.createElement("span");
  name.className = "team";
  name.textContent = TEAM_NAMES[team];
  liveries.appendChild(name);
  tones.forEach((color, tone) => {
    const b = document.createElement("button");
    b.className = "swatch";
    b.style.background = color;
    b.title = `${TEAM_NAMES[team]} ${tone === 0 ? "light" : "dark"}`;
    b.dataset.team = String(team);
    b.dataset.tone = String(tone);
    b.addEventListener("click", () => {
      livery.team = team;
      livery.tone = tone;
    });
    liveries.appendChild(b);
  });
});
const swatches = [...liveries.querySelectorAll<HTMLElement>(".swatch")];
$("resume").addEventListener("click", () => (paused = false));
const toggles = { obstacles: $("t-obstacles"), quake: $("t-quake") };
toggles.obstacles.addEventListener("click", toggleObstacles);
toggles.quake.addEventListener("click", toggleQuake);
let cameraBeforePause: CameraMode = "chase";
let wasPaused = false;
document.addEventListener("contextmenu", (e) => e.preventDefault());

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const blend = (a: Pose, b: Pose, t: number): Pose => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), heading: lerpAngle(a.heading, b.heading, t) });

function toScene(p: Pose): { x: number; z: number; heading: number } {
  const c = toContractPoint({ x: p.x, y: p.y });
  return { x: c.x, z: c.z, heading: toContractHeading(p.heading) };
}

function toggleObstacles(): void {
  obstaclesOn = !obstaclesOn;
  applyWorld();
}

function toggleQuake(): void {
  quakeOn = !quakeOn;
  applyWorld();
}

function stepOnce(): void {
  readInput(m1.dt);
  const b = m1.physics.bikes.get(PLAYER)!;
  prevBike = { x: b.x, y: b.y, heading: b.heading };
  prevCars = new Map(cars.map((c) => [c.id, { x: c.x, y: c.y, heading: c.heading }]));
  cars = m1.step().cars;
  const after = m1.physics.bikes.get(PLAYER)!;
  if (after.fallen && standUpAt === null) {
    standUpAt = m1.tick + PENALTY_TICKS;
    (m1.scenario.events ??= []).push({ at: standUpAt, standUp: [PLAYER] });
  }
  if (!after.fallen) standUpAt = null;

  const serverTime = m1.tick * m1.dt;
  const local = performance.now() / 1000;
  const rivals = cars.slice(0, RIVALS.length);
  rivalFeed.push(
    serverTime,
    rivals.map((c, i) => ({
      id: 100 + i,
      team: RIVALS[i].team,
      tone: RIVALS[i].tone,
      ...toScene(c),
      lean: 0,
      speed: c.speed,
      sliding: false,
      fallen: false,
    })),
    local,
  );
  carFeed.push(
    serverTime,
    cars.slice(RIVALS.length).map((c) => ({ id: c.id, ...toScene(c), length: c.length, width: c.width, offroad: c.state === "offroad" })),
    local,
  );
}

let last = performance.now();
let acc = 0;
let shownKmh = -1;
const frameRate = new FrameRate();
const capButtons = [...document.querySelectorAll<HTMLElement>("[data-cap]")];
for (const b of capButtons) b.addEventListener("click", () => (frameRate.limit = Number(b.dataset.cap) || null));

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  let steps = 0;
  while (acc >= m1.dt && steps < 5) {
    if (!paused) stepOnce();
    acc -= m1.dt;
    steps++;
  }
  if (steps === 5) acc = 0;
  const t = paused ? 1 : Math.min(1, acc / m1.dt);
  const drawDt = frameRate.frame(now, dt);
  if (drawDt === null) {
    requestAnimationFrame(frame);
    return;
  }

  const b = m1.physics.bikes.get(PLAYER)!;
  const me: ScenePlayer = {
    id: PLAYER,
    team: livery.team,
    tone: livery.tone,
    ...toScene(blend(prevBike, b, t)),
    lean: b.lean,
    speed: b.speed,
    sliding: b.sliding,
    fallen: b.fallen,
  };
  const localNow = now / 1000;
  const sceneCars: SceneCar[] = showCars ? carFeed.sample(localNow) : [];
  const rivals: ScenePlayer[] = showCars ? rivalFeed.sample(localNow) : [];

  scene.topSpeed = m1.physics.params.topSpeed;
  if (paused !== wasPaused) {
    if (paused) {
      cameraBeforePause = scene.cameraMode === "showroom" ? "chase" : scene.cameraMode;
      scene.cameraMode = "showroom";
    } else {
      scene.cameraMode = cameraBeforePause;
    }
    wasPaused = paused;
  }
  swatches.forEach((b) => b.classList.toggle("on", Number(b.dataset.team) === livery.team && Number(b.dataset.tone) === livery.tone));
  scene.update(
    {
      self: PLAYER,
      players: [me, ...rivals],
      cars: sceneCars,
      obstacles: obstaclesOn ? DEMO_OBSTACLES : [],
      quake: quakeOn ? QUAKE : null,
    },
    drawDt,
  );
  toggles.obstacles.classList.toggle("on", obstaclesOn);
  toggles.quake.classList.toggle("on", quakeOn);
  audio.update(paused ? 0.1 : scene.gearbox.rpm, paused ? 0 : scene.gearbox.load, drawDt);
  audio.skid(paused ? 0 : scene.skid, b.speed);
  scene.render();

  const speed = Math.round(Math.abs(b.speed) * 3.6);
  if (speed !== shownKmh) {
    kmh.textContent = String(speed);
    shownKmh = speed;
  }
  for (const btn of holdButtons) btn.classList.toggle("down", isHeld(btn.dataset.hold!, ALIAS[btn.dataset.hold!]));
  toolButtons.get("c")?.classList.toggle("on", scene.cameraMode === "overview");
  toolButtons.get("n")?.classList.toggle("on", showCars);
  toolButtons.get("p")?.classList.toggle("on", paused);
  pausedEl.classList.toggle("show", paused);

  fpsText.textContent = frameRate.limit ? `${frameRate.fps} / ${frameRate.limit} FPS` : `${frameRate.fps} FPS`;
  for (const b of capButtons) b.classList.toggle("on", (Number(b.dataset.cap) || null) === frameRate.limit);
  requestAnimationFrame(frame);
}
loadScooter()
  .catch((e) => console.warn("scooter model not loaded, using the built-in one", e))
  .finally(() => {
    last = performance.now();
    requestAnimationFrame(frame);
  });
