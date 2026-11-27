/// <reference lib="dom" />
/**
 * M3 test page (issue #38): the city from above, one motorcycle driven with the
 * keyboard, parameters changed with keys. Start it with `npm run debug`.
 *
 * The fake M1 builds the world from the city plan (stores, buildings) and calls
 * the traffic part and the physics part like the game server. Until M3-2 brings
 * the colliders there are no collisions; this page puts a puddle on one road
 * and an earthquake area that a key turns on.
 *
 * Drawing: x to the east and y to the north (up), like M3 inside.
 */
import type { SurfaceProvider } from '../src/physics';
import type { NpcCarPose } from '../src/traffic/npc';
import { FakeM1 } from '../test/fakes/fakeM1';

// ---- test areas that stand in for M3-2 (M3 coordinates) ----
const PUDDLE = { x0: 130, x1: 165, y0: -7, y1: 0 };
const QUAKE = { x: 250, y: -250, r: 90 };
let quakeOn = false;

const inPuddle = (x: number, y: number): boolean => x >= PUDDLE.x0 && x <= PUDDLE.x1 && y >= PUDDLE.y0 && y <= PUDDLE.y1;
const inQuake = (x: number, y: number): boolean => quakeOn && Math.hypot(x - QUAKE.x, y - QUAKE.y) <= QUAKE.r;

const testGround: SurfaceProvider = (x, y, p) => {
  let grip = p.grip;
  if (inPuddle(x, y)) grip = Math.min(grip, p.gripPuddle);
  if (inQuake(x, y)) grip = Math.min(grip, p.gripQuake);
  return { grip, speedCap: null };
};

// ---- keyboard ----
const held = new Set<string>();
const isHeld = (...keys: string[]): boolean => keys.some((k) => held.has(k));
let speedFactor = 1;

// ---- the fake server ----
const PLAYER = 0;
let m1: FakeM1;
let cars: NpcCarPose[] = [];
const trail: { x: number; y: number; slide: boolean }[] = [];

// TAHMİN: the real time that a fallen motorcycle stays down will come from the penalty rule of M1.
const FALL_RECOVERY_S = 3;
/** Tick in which the own motorcycle was first seen fallen, or null while it stands. */
let fallenAtTick: number | null = null;

function reset(): void {
  const keep = m1?.physics.params;
  m1 = new FakeM1({
    seed: 7,
    players: [PLAYER],
    npcCars: 30,
    speedFactor: { [PLAYER]: speedFactor },
    control: () => ({
      throttle: isHeld('arrowup', 'w') ? 1 : 0,
      brake: isHeld('arrowdown', 's') ? 1 : 0,
      steer: (isHeld('arrowright', 'd') ? 1 : 0) - (isHeld('arrowleft', 'a') ? 1 : 0),
    }),
  });
  if (keep) m1.physics.params = keep;
  m1.physics.surfaceAt = testGround;
  cars = [];
  trail.length = 0;
  fallenAtTick = null;
}
reset();

const bike = () => m1.physics.bikes.get(PLAYER)!;

let paused = false;
let follow = true;
let showCars = true;
let scale = 5; // pixels per metre

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  held.add(k);
  if (e.repeat) return;
  const p = m1.physics.params;
  switch (k) {
    case '1': p.topSpeed = clamp(p.topSpeed - 1, 5, 30); break;
    case '2': p.topSpeed = clamp(p.topSpeed + 1, 5, 30); break;
    case '3': p.grip = round1(clamp(p.grip - 0.1, 0.1, 1.5)); break;
    case '4': p.grip = round1(clamp(p.grip + 0.1, 0.1, 1.5)); break;
    case '5': speedFactor = round1(clamp(speedFactor - 0.1, 0.5, 1.5)); break;
    case '6': speedFactor = round1(clamp(speedFactor + 0.1, 0.5, 1.5)); break;
    case 'q': quakeOn = !quakeOn; break;
    case 'n': showCars = !showCars; break;
    case 'c': follow = !follow; break;
    case '+': case '=': scale = clamp(scale * 1.25, 0.8, 30); break;
    case '-': scale = clamp(scale / 1.25, 0.8, 30); break;
    case 'r': reset(); break;
    case 'p': paused = !paused; break;
  }
  if (m1.scenario.speedFactor) m1.scenario.speedFactor[PLAYER] = speedFactor;
});
window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());

function stepOnce(): void {
  // A fallen motorcycle stands up after FALL_RECOVERY_S: give M1's standUp for it through the scenario events.
  if (!bike().fallen) {
    fallenAtTick = null;
  } else if (fallenAtTick === null) {
    fallenAtTick = m1.tick;
  } else if (m1.tick - fallenAtTick >= Math.round(FALL_RECOVERY_S / m1.dt)) {
    (m1.scenario.events ??= []).push({ at: m1.tick, standUp: [PLAYER] });
    fallenAtTick = null;
  }
  cars = m1.step().cars;
  const b = bike();
  trail.push({ x: b.x, y: b.y, slide: b.sliding });
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

const TEAM_COLOURS: Record<string, string> = { blue: '#4c8dff', green: '#3ccf7a', purple: '#a66bff', yellow: '#f2c230' };

function draw(): void {
  const city = m1.city;
  const b = bike();
  const size = city.size;
  const roadWidth = 2 * city.lanesPerDirection * city.laneWidth;
  const cam = follow ? { cx: b.x, cy: b.y, s: scale } : { cx: size / 2, cy: -size / 2, s: Math.min(w, h) / (size + 60) };
  const { cx, cy, s } = cam;
  const sx = (x: number): number => (x - cx) * s + w / 2;
  const sy = (y: number): number => -(y - cy) * s + h / 2;

  ctx.fillStyle = '#1d2129';
  ctx.fillRect(0, 0, w, h);
  // Ground of the city.
  ctx.fillStyle = '#2c3a30';
  ctx.fillRect(sx(-roadWidth), sy(roadWidth), (size + 2 * roadWidth) * s, (size + 2 * roadWidth) * s);

  // Roads.
  ctx.lineCap = 'square';
  ctx.strokeStyle = '#4b505b';
  ctx.lineWidth = roadWidth * s;
  ctx.beginPath();
  for (const r of city.graph.roads) {
    const a = city.graph.nodes[r.a];
    const c = city.graph.nodes[r.b];
    ctx.moveTo(sx(a.x), sy(a.y));
    ctx.lineTo(sx(c.x), sy(c.y));
  }
  ctx.stroke();
  // Centre lines.
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#d8b84a';
  ctx.lineWidth = Math.max(1, 0.2 * s);
  ctx.setLineDash([3 * s, 3 * s]);
  ctx.beginPath();
  for (const r of city.graph.roads) {
    const a = city.graph.nodes[r.a];
    const c = city.graph.nodes[r.b];
    const ux = Math.sign(c.x - a.x);
    const uy = Math.sign(c.y - a.y);
    const cut = roadWidth / 2;
    ctx.moveTo(sx(a.x + ux * cut), sy(a.y + uy * cut));
    ctx.lineTo(sx(c.x - ux * cut), sy(c.y - uy * cut));
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Buildings from the city plan (boxes until the 3D model is ready).
  for (const bd of city.buildings) {
    ctx.beginPath();
    bd.polygon.forEach((p, i) => (i === 0 ? ctx.moveTo(sx(p.x), sy(p.y)) : ctx.lineTo(sx(p.x), sy(p.y))));
    ctx.closePath();
    const shade = Math.round(60 + bd.height * 2);
    ctx.fillStyle = `rgb(${shade}, ${shade + 6}, ${shade + 16})`;
    ctx.fill();
    ctx.strokeStyle = '#7d8798';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Team stores (pickup area).
  for (const st of city.stores) {
    ctx.beginPath();
    ctx.arc(sx(st.x), sy(st.y), Math.max(4, st.radius * s), 0, 2 * Math.PI);
    ctx.fillStyle = (TEAM_COLOURS[st.color] ?? '#fff') + '66';
    ctx.fill();
    ctx.strokeStyle = TEAM_COLOURS[st.color] ?? '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

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
  if (showCars) {
    for (const c of cars) {
      ctx.save();
      ctx.translate(sx(c.x), sy(c.y));
      ctx.rotate(-c.heading);
      ctx.fillStyle = c.state === 'offroad' ? '#777' : c.state === 'stopped' ? '#c9a0ff' : '#6fa8ff';
      ctx.fillRect((-c.length / 2) * s, (-c.width / 2) * s, c.length * s, c.width * s);
      ctx.restore();
    }
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
  ctx.translate(sx(b.x), sy(b.y));
  ctx.rotate(-b.heading);
  ctx.fillStyle = b.fallen ? '#888' : b.sliding ? '#ffb347' : '#5ce19b';
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
  const b = bike();
  const p = m1.physics.params;
  const deg = (r: number): number => Math.round((r * 180) / Math.PI);
  const ground = inPuddle(b.x, b.y) ? 'puddle' : inQuake(b.x, b.y) ? 'earthquake' : 'road';
  const grip = testGround(b.x, b.y, p).grip;
  const leanSide = b.lean > 0.01 ? 'right' : b.lean < -0.01 ? 'left' : '';
  hud.innerHTML = [
    `speed      ${b.speed.toFixed(1)} m/s  (${Math.round(b.speed * 3.6)} km/h)`,
    `heading    ${deg(b.heading)}°`,
    `lean       ${Math.abs(deg(b.lean))}° ${leanSide}`,
    `slide      ${b.slip.toFixed(2)} m/s ${b.sliding ? '<span class="slide">SLIDING</span>' : ''}`,
    `ground     ${ground}, grip ${grip.toFixed(2)}`,
    ``,
    `top speed  ${p.topSpeed} m/s × ${speedFactor.toFixed(1)}`,
    `grip       road ${p.grip.toFixed(1)}  puddle ${p.gripPuddle}  quake ${p.gripQuake}`,
    `NPC cars   ${showCars ? cars.length : 'hidden'}`,
    `tick       ${m1.tick}${paused ? '  PAUSED' : ''}`,
  ].join('\n');
}

// ---- fixed 30 Hz simulation, drawn every frame ----
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  let steps = 0;
  while (acc >= m1.dt && steps < 5) {
    if (!paused) stepOnce();
    acc -= m1.dt;
    steps++;
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
