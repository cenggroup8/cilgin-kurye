/// <reference lib="dom" />
/**
 * M3 test page (issue #38): the city from above, one motorcycle driven with the
 * keyboard, parameters changed with keys. Start it with `npm run debug`.
 *
 * Until M3-2 brings the colliders, this page stands in for them with a puddle
 * on one road and an earthquake area that a key turns on. There are no
 * collisions yet. The NPC cars come from M3-4.
 *
 * Drawing: x to the right and y up, so a turn to the right looks like one.
 */
import {
  addBike,
  BIKE_STAGES,
  createWorld,
  EMPTY_STAGES,
  stepPhysics,
  type BikeState,
  type PhysicsWorld,
  type SurfaceProvider,
} from '../src/physics';
import { NpcTraffic, type NpcCarPose } from '../src/traffic/npc';
import { makeGridGraph } from '../test/fakes/fakeRoadGraph';

// ---- city (the real sizes: 6 roads each way, 100 m apart, 2 lanes each way) ----
const LANES = 2;
const graph = makeGridGraph({ spacing: 100, lanesPerDirection: LANES });
const ROAD_WIDTH = 2 * LANES * graph.laneWidth;
const CITY = 500;

// ---- test areas that stand in for M3-2 ----
const PUDDLE = { x0: 300, x1: 335, y0: 100 - ROAD_WIDTH / 2, y1: 100 };
const QUAKE = { x: 250, y: 250, r: 90 };
let quakeOn = false;

const inPuddle = (x: number, y: number): boolean => x >= PUDDLE.x0 && x <= PUDDLE.x1 && y >= PUDDLE.y0 && y <= PUDDLE.y1;
const inQuake = (x: number, y: number): boolean => quakeOn && Math.hypot(x - QUAKE.x, y - QUAKE.y) <= QUAKE.r;

const testGround: SurfaceProvider = (x, y, p) => {
  let grip = p.grip;
  if (inPuddle(x, y)) grip = Math.min(grip, p.gripPuddle);
  if (inQuake(x, y)) grip = Math.min(grip, p.gripQuake);
  return { grip, speedCap: null };
};

// ---- simulation ----
const DT = 1 / 30;
const STAGES = { ...EMPTY_STAGES, ...BIKE_STAGES };
const START = { x: 120, y: 100 - 1.5 * graph.laneWidth, heading: 0 };

let world: PhysicsWorld;
let bike: BikeState;
let traffic: NpcTraffic;
let cars: NpcCarPose[] = [];
let npcOn = true;
let speedFactor = 1;
let tick = 0;
const trail: { x: number; y: number; slide: boolean }[] = [];

function reset(): void {
  world = createWorld();
  world.surfaceAt = testGround;
  bike = addBike(world, 0, START);
  traffic = new NpcTraffic(graph, { seed: 7, params: { carCount: 30 } });
  cars = [];
  tick = 0;
  trail.length = 0;
}
reset();

// ---- keyboard ----
const held = new Set<string>();
let paused = false;
let follow = true;
let scale = 5; // pixels per metre

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  held.add(k);
  if (e.repeat) return;
  const p = world.params;
  switch (k) {
    case '1': p.topSpeed = clamp(p.topSpeed - 1, 5, 30); break;
    case '2': p.topSpeed = clamp(p.topSpeed + 1, 5, 30); break;
    case '3': p.grip = round1(clamp(p.grip - 0.1, 0.1, 1.5)); break;
    case '4': p.grip = round1(clamp(p.grip + 0.1, 0.1, 1.5)); break;
    case '5': speedFactor = round1(clamp(speedFactor - 0.1, 0.5, 1.5)); break;
    case '6': speedFactor = round1(clamp(speedFactor + 0.1, 0.5, 1.5)); break;
    case 'q': quakeOn = !quakeOn; break;
    case 'n': npcOn = !npcOn; if (!npcOn) cars = []; break;
    case 'c': follow = !follow; break;
    case '+': case '=': scale = clamp(scale * 1.25, 0.8, 30); break;
    case '-': scale = clamp(scale / 1.25, 0.8, 30); break;
    case 'r': reset(); break;
    case 'p': paused = !paused; break;
  }
});
window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());

const isHeld = (...keys: string[]): boolean => keys.some((k) => held.has(k));

function stepOnce(): void {
  const throttle = isHeld('arrowup', 'w') ? 1 : 0;
  const brake = isHeld('arrowdown', 's') ? 1 : 0;
  const steer = (isHeld('arrowright', 'd') ? 1 : 0) - (isHeld('arrowleft', 'a') ? 1 : 0);

  if (npcOn) {
    const pose = { id: 0, x: bike.x, y: bike.y, heading: bike.heading, speed: bike.speed, fallen: bike.fallen };
    cars = traffic.step({ dt: DT, players: [pose], obstacles: [], carHits: [] }).cars;
  }
  stepPhysics(
    world,
    {
      tick, dt: DT, obstacles: [], npcCars: cars, quake: null, fall: [], standUp: [],
      bikes: [{ player: 0, speedFactor, control: { throttle, brake, steer, seq: tick } }],
    },
    STAGES,
  );
  tick++;
  trail.push({ x: bike.x, y: bike.y, slide: bike.sliding });
  if (trail.length > 600) trail.shift();
}

// ---- drawing ----
const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;
let w = 0;
let h = 0;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  w = window.innerWidth;
  h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function camera(): { cx: number; cy: number; s: number } {
  if (follow) return { cx: bike.x, cy: bike.y, s: scale };
  return { cx: CITY / 2, cy: CITY / 2, s: Math.min(w, h) / (CITY + 60) };
}

function draw(): void {
  const { cx, cy, s } = camera();
  const sx = (x: number): number => (x - cx) * s + w / 2;
  const sy = (y: number): number => -(y - cy) * s + h / 2;

  ctx.fillStyle = '#1d2129';
  ctx.fillRect(0, 0, w, h);
  // Blocks.
  ctx.fillStyle = '#2c3a30';
  ctx.fillRect(sx(-ROAD_WIDTH), sy(CITY + ROAD_WIDTH), (CITY + 2 * ROAD_WIDTH) * s, (CITY + 2 * ROAD_WIDTH) * s);

  // Roads.
  ctx.lineCap = 'square';
  ctx.strokeStyle = '#4b505b';
  ctx.lineWidth = ROAD_WIDTH * s;
  ctx.beginPath();
  for (const r of graph.roads) {
    const a = graph.nodes[r.a];
    const b = graph.nodes[r.b];
    ctx.moveTo(sx(a.x), sy(a.y));
    ctx.lineTo(sx(b.x), sy(b.y));
  }
  ctx.stroke();
  // Centre lines.
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#d8b84a';
  ctx.lineWidth = Math.max(1, 0.2 * s);
  ctx.setLineDash([3 * s, 3 * s]);
  ctx.beginPath();
  for (const r of graph.roads) {
    const a = graph.nodes[r.a];
    const b = graph.nodes[r.b];
    const ux = Math.sign(b.x - a.x);
    const uy = Math.sign(b.y - a.y);
    const cut = ROAD_WIDTH / 2;
    ctx.moveTo(sx(a.x + ux * cut), sy(a.y + uy * cut));
    ctx.lineTo(sx(b.x - ux * cut), sy(b.y - uy * cut));
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Test areas.
  ctx.fillStyle = 'rgba(110, 190, 255, 0.45)';
  ctx.fillRect(sx(PUDDLE.x0), sy(PUDDLE.y1), (PUDDLE.x1 - PUDDLE.x0) * s, (PUDDLE.y1 - PUDDLE.y0) * s);
  if (quakeOn) {
    ctx.fillStyle = 'rgba(255, 80, 80, 0.18)';
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx(QUAKE.x), sy(QUAKE.y), QUAKE.r * s, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }

  // NPC cars.
  for (const c of cars) {
    ctx.save();
    ctx.translate(sx(c.x), sy(c.y));
    ctx.rotate(-c.heading);
    ctx.fillStyle = c.state === 'offroad' ? '#777' : c.state === 'stopped' ? '#c9a0ff' : '#6fa8ff';
    ctx.fillRect((-c.length / 2) * s, (-c.width / 2) * s, c.length * s, c.width * s);
    ctx.restore();
  }

  // Trail: green while the tyres hold, orange while sliding.
  ctx.lineWidth = 2;
  for (let i = 1; i < trail.length; i++) {
    const p = trail[i - 1];
    const q = trail[i];
    ctx.strokeStyle = q.slide ? 'rgba(255, 179, 71, 0.9)' : 'rgba(92, 225, 155, 0.45)';
    ctx.beginPath();
    ctx.moveTo(sx(p.x), sy(p.y));
    ctx.lineTo(sx(q.x), sy(q.y));
    ctx.stroke();
  }

  // The motorcycle: an arrow, at least 12 px long so it is visible from far away.
  const len = Math.max(12, 2.2 * s);
  ctx.save();
  ctx.translate(sx(bike.x), sy(bike.y));
  ctx.rotate(-bike.heading);
  ctx.fillStyle = bike.fallen ? '#888' : bike.sliding ? '#ffb347' : '#5ce19b';
  ctx.beginPath();
  ctx.moveTo(len * 0.6, 0);
  ctx.lineTo(-len * 0.4, len * 0.28);
  ctx.lineTo(-len * 0.4, -len * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  drawHud();
}

function drawHud(): void {
  const p = world.params;
  const deg = (r: number): number => Math.round((r * 180) / Math.PI);
  const ground = inPuddle(bike.x, bike.y) ? 'puddle' : inQuake(bike.x, bike.y) ? 'earthquake' : 'road';
  const grip = testGround(bike.x, bike.y, p).grip;
  const leanSide = bike.lean > 0.01 ? 'right' : bike.lean < -0.01 ? 'left' : '';
  hud.innerHTML = [
    `speed      ${bike.speed.toFixed(1)} m/s  (${Math.round(bike.speed * 3.6)} km/h)`,
    `heading    ${deg(bike.heading)}°`,
    `lean       ${Math.abs(deg(bike.lean))}° ${leanSide}`,
    `slide      ${bike.slip.toFixed(2)} m/s ${bike.sliding ? '<span class="slide">SLIDING</span>' : ''}`,
    `ground     ${ground}, grip ${grip.toFixed(2)}`,
    ``,
    `top speed  ${p.topSpeed} m/s × ${speedFactor.toFixed(1)}`,
    `grip       road ${p.grip.toFixed(1)}  puddle ${p.gripPuddle}  quake ${p.gripQuake}`,
    `NPC cars   ${npcOn ? cars.length : 'off'}`,
    `tick       ${tick}${paused ? '  PAUSED' : ''}`,
  ].join('\n');
}

// ---- fixed 30 Hz simulation, drawn every frame ----
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  let steps = 0;
  while (acc >= DT && steps < 5) {
    if (!paused) stepOnce();
    acc -= DT;
    steps++;
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
