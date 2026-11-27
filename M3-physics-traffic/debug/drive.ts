/// <reference lib="dom" />
import { colliderSurface } from '../src/physics/collide/index.js';
import type { SurfaceProvider } from '../src/physics/index.js';
import type { NpcCarPose } from '../src/traffic/npc/index.js';
import { FakeM1, type ScenarioEvent } from '../test/fakes/fakeM1.js';
import type { M3City } from '../test/fakes/cityPlan.js';

const PUDDLE = { x0: 130, x1: 165, y0: -7, y1: 0 };
const QUAKE = { x: 250, y: -250, r: 90 };
const PLAYER = 0;
const MAX_LEAN = Math.PI / 4;
const TOP_SPEED_MAX = 60;
const SKID_LIFE = 30 * 25;
const PENALTY_TICKS = 30 * 3;

const TEAM: Record<string, string> = { blue: '#4c8dff', green: '#35d07f', purple: '#a874ff', yellow: '#f5c542' };
const PAINT = ['#d9dde6', '#a3acbb', '#6b7890', '#c8574d', '#3f6fb5', '#d9b04a', '#39404d', '#5c8f7b'];

let quakeOn = false;
let paused = false;
let follow = true;
let showCars = true;
let zoom = 7;
let speedFactor = 1;
let standUpAt: number | null = null;

const inPuddle = (x: number, y: number): boolean => x >= PUDDLE.x0 && x <= PUDDLE.x1 && y >= PUDDLE.y0 && y <= PUDDLE.y1;
const inQuake = (x: number, y: number): boolean => quakeOn && Math.hypot(x - QUAKE.x, y - QUAKE.y) <= QUAKE.r;

const testGround: SurfaceProvider = (x, y, p) => {
  let grip = p.grip;
  if (inPuddle(x, y)) grip = Math.min(grip, p.gripPuddle);
  if (inQuake(x, y)) grip = Math.min(grip, p.gripQuake);
  return { grip, speedCap: null };
};

const held = new Set<string>();
const isHeld = (...keys: string[]): boolean => keys.some((k) => held.has(k));

type Pose = { x: number; y: number; heading: number };
type Skid = { ax: number; ay: number; bx: number; by: number; tick: number };

let m1: FakeM1;
let cars: NpcCarPose[] = [];
let prevCars = new Map<number, Pose>();
let prevBike: Pose = { x: 0, y: 0, heading: 0 };
const trail: { x: number; y: number }[] = [];
const skids: Skid[] = [];
const cam = { x: 0, y: 0, s: zoom };

const bike = () => m1.physics.bikes.get(PLAYER)!;
const poseOf = (p: Pose): Pose => ({ x: p.x, y: p.y, heading: p.heading });

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
  m1.physics.surfaceAt = colliderSurface(m1.physics, testGround);
  cars = [];
  prevCars = new Map();
  prevBike = poseOf(bike());
  trail.length = 0;
  skids.length = 0;
  standUpAt = null;
  cam.x = prevBike.x;
  cam.y = prevBike.y;
  buildCity(m1.city);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const deg = (r: number): number => Math.round((r * 180) / Math.PI);

function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  held.add(k);
  const p = m1.physics.params;
  if (e.repeat && k !== '1' && k !== '2') return;
  switch (k) {
    case '1': p.topSpeed = clamp(p.topSpeed - 1, 5, TOP_SPEED_MAX); break;
    case '2': p.topSpeed = clamp(p.topSpeed + 1, 5, TOP_SPEED_MAX); break;
    case '3': p.grip = round1(clamp(p.grip - 0.1, 0.1, 1.5)); break;
    case '4': p.grip = round1(clamp(p.grip + 0.1, 0.1, 1.5)); break;
    case '5': speedFactor = round1(clamp(speedFactor - 0.1, 0.5, 1.5)); break;
    case '6': speedFactor = round1(clamp(speedFactor + 0.1, 0.5, 1.5)); break;
    case 'q': quakeOn = !quakeOn; break;
    case 'n': showCars = !showCars; break;
    case 'c': follow = !follow; break;
    case '+': case '=': zoom = clamp(zoom * 1.25, 1, 30); break;
    case '-': zoom = clamp(zoom / 1.25, 1, 30); break;
    case 'r': reset(); break;
    case 'p': paused = !paused; break;
    case 'f': schedule({ at: m1.tick, fall: [PLAYER] }); break;
  }
  if (m1.scenario.speedFactor) m1.scenario.speedFactor[PLAYER] = speedFactor;
});
window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());

function schedule(event: ScenarioEvent): void {
  (m1.scenario.events ??= []).push(event);
}

function stepOnce(): void {
  const wasDown = bike().fallen;
  prevBike = poseOf(bike());
  prevCars = new Map(cars.map((c) => [c.id, poseOf(c)]));
  cars = m1.step().cars;
  const b = bike();
  trail.push({ x: b.x, y: b.y });
  if (trail.length > 240) trail.shift();
  if (b.sliding) skids.push({ ax: prevBike.x, ay: prevBike.y, bx: b.x, by: b.y, tick: m1.tick });
  while (skids.length && m1.tick - skids[0].tick > SKID_LIFE) skids.shift();
  if (b.fallen && !wasDown) {
    standUpAt = m1.tick + PENALTY_TICKS;
    schedule({ at: standUpAt, standUp: [PLAYER] });
  }
  if (!b.fallen) standUpAt = null;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
const miniCanvas = $<HTMLCanvasElement>('mini-canvas');
const mctx = miniCanvas.getContext('2d')!;
let w = 0;
let h = 0;
let mw = 0;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  w = window.innerWidth;
  h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mw = miniCanvas.clientWidth;
  miniCanvas.width = Math.round(mw * dpr);
  miniCanvas.height = Math.round(mw * dpr);
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);

type Segment = { ax: number; ay: number; bx: number; by: number; ux: number; uy: number };
type Block = { x0: number; y0: number; x1: number; y1: number; park: boolean };
type Building = M3City['buildings'][number] & { cx: number; cy: number };

let roadWidth = 0;
let segments: Segment[] = [];
let blocks: Block[] = [];
let buildings: Building[] = [];

function buildCity(city: M3City): void {
  roadWidth = 2 * city.lanesPerDirection * city.laneWidth;
  const nodes = city.graph.nodes;
  segments = city.graph.roads.map((r) => {
    const a = nodes[r.a];
    const b = nodes[r.b];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { ax: a.x, ay: a.y, bx: b.x, by: b.y, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len };
  });
  const xs = [...new Set(nodes.map((n) => n.x))].sort((a, b) => a - b);
  const ys = [...new Set(nodes.map((n) => n.y))].sort((a, b) => a - b);
  const half = roadWidth / 2;
  blocks = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      blocks.push({ x0: xs[i] + half, x1: xs[i + 1] - half, y0: ys[j] + half, y1: ys[j + 1] - half, park: hash(i, j, 7) > 0.5 });
    }
  }
  buildings = city.buildings
    .map((b) => ({
      ...b,
      cx: b.polygon.reduce((s, p) => s + p.x, 0) / b.polygon.length,
      cy: b.polygon.reduce((s, p) => s + p.y, 0) / b.polygon.length,
    }))
    .sort((a, b) => b.cy - a.cy);
}

let sx = (x: number): number => x;
let sy = (y: number): number => y;
let S = 1;

function rect(x0: number, y0: number, x1: number, y1: number, r = 0): void {
  ctx.beginPath();
  ctx.roundRect(sx(x0), sy(y1), (x1 - x0) * S, (y1 - y0) * S, r * S);
}

function drawGround(city: M3City): void {
  const half = roadWidth / 2;
  const pad = half + 4;
  ctx.fillStyle = '#3a3e47';
  rect(-pad, -city.size - pad, city.size + pad, pad, 6);
  ctx.fill();
  ctx.fillStyle = '#25282e';
  rect(-half, -city.size - half, city.size + half, half, 2);
  ctx.fill();

  for (const b of blocks) {
    ctx.fillStyle = '#3a3e47';
    rect(b.x0, b.y0, b.x1, b.y1, 3);
    ctx.fill();
    ctx.fillStyle = b.park ? '#1f2c25' : '#2a2d33';
    rect(b.x0 + 3, b.y0 + 3, b.x1 - 3, b.y1 - 3, 2);
    ctx.fill();
  }
}

function roadLine(offset: number, trim: number, colour: string, width: number, dash: number[]): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1, width * S);
  ctx.setLineDash(dash.map((d) => d * S));
  ctx.beginPath();
  for (const g of segments) {
    const px = -g.uy * offset;
    const py = g.ux * offset;
    ctx.moveTo(sx(g.ax + g.ux * trim + px), sy(g.ay + g.uy * trim + py));
    ctx.lineTo(sx(g.bx - g.ux * trim + px), sy(g.by - g.uy * trim + py));
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawMarkings(city: M3City): void {
  const half = roadWidth / 2;
  const walk = S >= 2 ? 3.5 : 0;
  const trim = half + walk + 0.5;
  roadLine(0.18, trim, '#d8b44a', 0.15, []);
  roadLine(-0.18, trim, '#d8b44a', 0.15, []);
  if (S < 1.5) return;
  for (const o of [-city.laneWidth, city.laneWidth]) roadLine(o, trim, 'rgba(255,255,255,0.32)', 0.14, [3, 5]);
  for (const o of [-(half - 0.4), half - 0.4]) roadLine(o, half, 'rgba(255,255,255,0.18)', 0.12, []);
  if (!walk) return;
  ctx.fillStyle = 'rgba(255,255,255,0.34)';
  ctx.beginPath();
  for (const g of segments) {
    for (const end of [0, 1]) {
      const bx = end ? g.bx - g.ux * (half + walk) : g.ax + g.ux * half;
      const by = end ? g.by - g.uy * (half + walk) : g.ay + g.uy * half;
      for (let o = -half + 0.8; o < half - 0.5; o += 1.1) {
        const x0 = bx - g.uy * o;
        const y0 = by + g.ux * o;
        const x1 = x0 + g.ux * walk - g.uy * 0.55;
        const y1 = y0 + g.uy * walk + g.ux * 0.55;
        ctx.rect(sx(Math.min(x0, x1)), sy(Math.max(y0, y1)), Math.abs(x1 - x0) * S, Math.abs(y1 - y0) * S);
      }
    }
  }
  ctx.fill();
}

function drawPuddle(time: number): void {
  const p = PUDDLE;
  const g = ctx.createLinearGradient(sx(p.x0), 0, sx(p.x1), 0);
  g.addColorStop(0, 'rgba(108,196,255,0.25)');
  g.addColorStop(0.5, 'rgba(140,210,255,0.5)');
  g.addColorStop(1, 'rgba(108,196,255,0.25)');
  ctx.fillStyle = g;
  rect(p.x0, p.y0, p.x1, p.y1, 2.5);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(220,240,255,0.35)';
  ctx.lineWidth = Math.max(1, 0.12 * S);
  for (let i = 0; i < 6; i++) {
    const x = p.x0 + (((time / 900 + i / 6) % 1) * (p.x1 - p.x0 + 8)) - 4;
    const y = p.y0 + ((i * 2.3) % (p.y1 - p.y0));
    ctx.beginPath();
    ctx.moveTo(sx(x), sy(y));
    ctx.lineTo(sx(x + 3), sy(y));
    ctx.stroke();
  }
  ctx.restore();
}

function drawQuake(time: number): void {
  if (!quakeOn) return;
  const cx = sx(QUAKE.x);
  const cy = sy(QUAKE.y);
  const r = QUAKE.r * S;
  const fill = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  fill.addColorStop(0, 'rgba(255,90,90,0.28)');
  fill.addColorStop(1, 'rgba(255,90,90,0.04)');
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 3; i++) {
    const t = (time / 1600 + i / 3) % 1;
    ctx.strokeStyle = `rgba(255,107,107,${0.55 * (1 - t)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r * t, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,107,107,0.6)';
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawTracks(): void {
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, 0.28 * S);
  for (const k of skids) {
    const age = (m1.tick - k.tick) / SKID_LIFE;
    ctx.strokeStyle = `rgba(8,8,10,${0.75 * (1 - age)})`;
    ctx.beginPath();
    ctx.moveTo(sx(k.ax), sy(k.ay));
    ctx.lineTo(sx(k.bx), sy(k.by));
    ctx.stroke();
  }
  ctx.lineWidth = Math.max(1.5, 0.35 * S);
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    ctx.strokeStyle = `rgba(95,227,168,${(0.35 * i) / trail.length})`;
    ctx.beginPath();
    ctx.moveTo(sx(a.x), sy(a.y));
    ctx.lineTo(sx(b.x), sy(b.y));
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

const centre = { x: 0, y: 0 };

function drawBuildings(): void {
  const lit = S >= 3;
  const eye = 4.5 * (Math.max(w, h) / 2 / S);
  const order = buildings
    .map((b) => ({ b, d: Math.hypot(sx(b.cx) - centre.x, sy(b.cy) - centre.y) }))
    .sort((p, q) => q.d - p.d);
  for (const { b } of order) {
    const k = eye / (eye - b.height);
    const base = b.polygon.map((p) => ({ x: sx(p.x), y: sy(p.y) }));
    const roof = base.map((p) => ({ x: centre.x + (p.x - centre.x) * k, y: centre.y + (p.y - centre.y) * k }));
    const all = base.concat(roof);
    const minX = Math.min(...all.map((p) => p.x));
    const maxX = Math.max(...all.map((p) => p.x));
    const minY = Math.min(...all.map((p) => p.y));
    const maxY = Math.max(...all.map((p) => p.y));
    if (maxX < -40 || minX > w + 40 || maxY < -40 || minY > h + 40) continue;
    const tall = (b.height - 12) / 24;
    const mid = { x: sx(b.cx), y: sy(b.cy) };

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 4 + b.height * 0.25 * Math.min(S, 4);
    ctx.shadowOffsetX = b.height * 0.1 * S;
    ctx.shadowOffsetY = b.height * 0.06 * S;
    ctx.fillStyle = '#16181d';
    path(base);
    ctx.fill();
    ctx.restore();

    const n = base.length;
    for (let i = 0; i < n; i++) {
      const a = base[i];
      const c = base[(i + 1) % n];
      const ex = (a.x + c.x) / 2;
      const ey = (a.y + c.y) / 2;
      let nx = c.y - a.y;
      let ny = -(c.x - a.x);
      if (nx * (ex - mid.x) + ny * (ey - mid.y) < 0) {
        nx = -nx;
        ny = -ny;
      }
      if (nx * (centre.x - ex) + ny * (centre.y - ey) <= 0) continue;
      const len = Math.hypot(nx, ny) || 1;
      const light = 20 + 7 * ((-nx - ny) / len);
      ctx.fillStyle = `hsl(222, ${12 + tall * 10}%, ${light + tall * 4}%)`;
      path([a, c, roof[(i + 1) % n], roof[i]]);
      ctx.fill();
      if (lit) windows(b, i, a, c, roof[i], roof[(i + 1) % n]);
    }

    roofTop(b, roof, tall);
  }
}

function roofTop(b: Building, roof: P[], tall: number): void {
  const xs = roof.map((p) => p.x);
  const ys = roof.map((p) => p.y);
  const g = ctx.createLinearGradient(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  g.addColorStop(0, `hsl(220, ${9 + tall * 8}%, ${27 + tall * 7}%)`);
  g.addColorStop(1, `hsl(220, ${9 + tall * 8}%, ${21 + tall * 6}%)`);
  ctx.fillStyle = g;
  path(roof);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (S < 1.5 || roof.length !== 4) return;
  const at = (u: number, v: number): P => ({
    x: lerp(lerp(roof[0].x, roof[1].x, u), lerp(roof[3].x, roof[2].x, u), v),
    y: lerp(lerp(roof[0].y, roof[1].y, u), lerp(roof[3].y, roof[2].y, u), v),
  });
  const inset = 0.035;
  path([at(inset, inset), at(1 - inset, inset), at(1 - inset, 1 - inset), at(inset, 1 - inset)]);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = Math.max(1, 0.5 * S);
  ctx.stroke();
  const units = 2 + Math.floor(hash(b.id, 1, 2) * 4);
  for (let i = 0; i < units; i++) {
    const u = 0.15 + hash(b.id, i, 3) * 0.6;
    const v = 0.15 + hash(b.id, i, 4) * 0.6;
    const du = 0.05 + hash(b.id, i, 5) * 0.1;
    const dv = 0.05 + hash(b.id, i, 6) * 0.08;
    const box = [at(u, v), at(u + du, v), at(u + du, v + dv), at(u, v + dv)];
    const lift = (1.2 + hash(b.id, i, 8) * 2) * S;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    path(box.map((p) => ({ x: p.x + lift * 0.6, y: p.y + lift * 0.35 })));
    ctx.fill();
    ctx.fillStyle = `hsl(220, 8%, ${36 + tall * 8}%)`;
    path(box);
    ctx.fill();
  }
  if (b.height >= 28) {
    const c = at(0.78, 0.22);
    const r = Math.max(3, 2.6 * S);
    ctx.strokeStyle = 'rgba(255,214,140,0.5)';
    ctx.lineWidth = Math.max(1, 0.25 * S);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `700 ${r * 1.2}px -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,214,140,0.6)';
    ctx.fillText('H', c.x, c.y + r * 0.05);
    ctx.textBaseline = 'alphabetic';
  }
}

type P = { x: number; y: number };

function path(pts: P[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function windows(b: Building, wall: number, a: P, c: P, ra: P, rc: P): void {
  const span = Math.hypot(c.x - a.x, c.y - a.y) / S;
  const cols = Math.floor(span / 4.5);
  const rows = Math.floor(b.height / 3.6);
  const at = (u: number, v: number): P => ({
    x: lerp(lerp(a.x, c.x, u), lerp(ra.x, rc.x, u), v),
    y: lerp(lerp(a.y, c.y, u), lerp(ra.y, rc.y, u), v),
  });
  const on = new Path2D();
  const off = new Path2D();
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const u0 = (i + 0.3) / cols;
      const u1 = (i + 0.7) / cols;
      const v0 = (j + 0.3) / rows;
      const v1 = (j + 0.75) / rows;
      const q = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
      const target = hash(b.id, wall * 97 + i, j) > 0.62 ? on : off;
      target.moveTo(q[0].x, q[0].y);
      for (let k = 1; k < 4; k++) target.lineTo(q[k].x, q[k].y);
      target.closePath();
    }
  }
  ctx.fillStyle = 'rgba(14,17,24,0.55)';
  ctx.fill(off);
  ctx.fillStyle = 'rgba(255,214,140,0.78)';
  ctx.fill(on);
}

function drawStores(city: M3City, time: number): void {
  for (const st of city.stores) {
    const colour = TEAM[st.color] ?? '#ffffff';
    const x = sx(st.x);
    const y = sy(st.y);
    const r = Math.max(6, st.radius * S);
    ctx.fillStyle = colour + '22';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time / 2400);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.setLineDash([r * 0.32, r * 0.2]);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);
    const box = Math.max(5, 3.2 * S);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.roundRect(x - box / 2, y - box / 2, box, box, box * 0.2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(1, box * 0.08);
    ctx.beginPath();
    ctx.moveTo(x - box / 2, y);
    ctx.lineTo(x + box / 2, y);
    ctx.moveTo(x, y - box / 2);
    ctx.lineTo(x, y + box / 2);
    ctx.stroke();
    if (S >= 1.2) {
      ctx.font = `700 ${clamp(S * 2.2, 10, 15)}px -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = colour;
      ctx.fillText(st.color.toUpperCase(), x, y + r + clamp(S * 2.6, 13, 20));
    }
  }
}

function drawCars(alpha: number, time: number): void {
  for (const c of cars) {
    const p = prevCars.get(c.id) ?? c;
    const x = sx(lerp(p.x, c.x, alpha));
    const y = sy(lerp(p.y, c.y, alpha));
    const L = c.length * S;
    const W = c.width * S;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-lerpAngle(p.heading, c.heading, alpha));
    ctx.globalAlpha = c.state === 'offroad' ? 0.45 : 1;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.roundRect(-L / 2 + 0.5 * S, -W / 2 + 0.4 * S, L, W, 0.5 * S);
    ctx.fill();
    ctx.fillStyle = c.state === 'offroad' ? '#5a5f69' : PAINT[c.id % PAINT.length];
    ctx.beginPath();
    ctx.roundRect(-L / 2, -W / 2, L, W, Math.min(W / 2, 0.55 * S));
    ctx.fill();
    if (S >= 2) {
      ctx.fillStyle = 'rgba(15,20,30,0.75)';
      ctx.beginPath();
      ctx.roundRect(-L * 0.22, -W * 0.38, L * 0.46, W * 0.76, 0.3 * S);
      ctx.fill();
      ctx.fillStyle = 'rgba(160,200,255,0.35)';
      ctx.fillRect(L * 0.16, -W * 0.34, L * 0.07, W * 0.68);
      ctx.fillStyle = '#fff3c4';
      ctx.fillRect(L / 2 - 0.25 * S, -W * 0.42, 0.25 * S, W * 0.2);
      ctx.fillRect(L / 2 - 0.25 * S, W * 0.22, 0.25 * S, W * 0.2);
      const braking = c.speed < 1.5;
      ctx.fillStyle = braking ? '#ff4b4b' : '#7a2323';
      ctx.fillRect(-L / 2, -W * 0.42, 0.22 * S, W * 0.2);
      ctx.fillRect(-L / 2, W * 0.22, 0.22 * S, W * 0.2);
      if (c.state === 'stopped' && Math.floor(time / 350) % 2 === 0) {
        ctx.fillStyle = '#ffb44c';
        for (const [fx, fy] of [[L / 2, -W / 2], [L / 2, W / 2], [-L / 2, -W / 2], [-L / 2, W / 2]]) {
          ctx.beginPath();
          ctx.arc(fx, fy, 0.35 * S, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }
}

function drawBike(alpha: number, time: number): void {
  const b = bike();
  const x = sx(lerp(prevBike.x, b.x, alpha));
  const y = sy(lerp(prevBike.y, b.y, alpha));
  const heading = lerpAngle(prevBike.heading, b.heading, alpha);
  const body = b.fallen ? '#8b93a5' : b.sliding ? '#ffb44c' : '#5fe3a8';
  const len = 2.1 * S * 1.6;

  if (S < 3) {
    const pulse = (time / 1100) % 1;
    ctx.strokeStyle = `rgba(95,227,168,${0.7 * (1 - pulse)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 8 + pulse * 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-heading);
    ctx.fillStyle = body;
    ctx.strokeStyle = '#0f1115';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-heading);
  if (!b.fallen) {
    const reach = 22 * S;
    const cone = ctx.createRadialGradient(len * 0.5, 0, 0, len * 0.5, 0, reach);
    cone.addColorStop(0, 'rgba(255,244,210,0.32)');
    cone.addColorStop(1, 'rgba(255,244,210,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(len * 0.5, 0);
    ctx.arc(len * 0.5, 0, reach, -0.32, 0.32);
    ctx.closePath();
    ctx.fill();
  }
  if (b.fallen) ctx.rotate(Math.PI / 2.4);
  const wid = 0.75 * S * 1.6;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(0.3 * S, 0.35 * S, len * 0.55, wid * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#14161b';
  ctx.beginPath();
  ctx.roundRect(len * 0.28, -wid * 0.2, len * 0.24, wid * 0.4, wid * 0.2);
  ctx.roundRect(-len * 0.52, -wid * 0.22, len * 0.26, wid * 0.44, wid * 0.2);
  ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(-len * 0.4, -wid / 2, len * 0.78, wid, wid / 2);
  ctx.fill();
  ctx.strokeStyle = '#14161b';
  ctx.lineWidth = Math.max(1.5, 0.12 * S);
  ctx.beginPath();
  ctx.moveTo(len * 0.22, -wid * 0.95);
  ctx.lineTo(len * 0.22, wid * 0.95);
  ctx.stroke();
  ctx.fillStyle = '#e9edf5';
  ctx.beginPath();
  ctx.arc(-len * 0.05, 0, 0.58 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4c8dff';
  ctx.beginPath();
  ctx.arc(-len * 0.05 - 0.08 * S, 0, 0.36 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawVignette(): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawMini(city: M3City, alpha: number): void {
  const pad = 6;
  const k = (mw - pad * 2) / city.size;
  const mx = (x: number): number => pad + x * k;
  const my = (y: number): number => pad - y * k;
  mctx.clearRect(0, 0, mw, mw);
  mctx.strokeStyle = '#3b404b';
  mctx.lineWidth = 2.2;
  mctx.lineCap = 'round';
  mctx.beginPath();
  for (const g of segments) {
    mctx.moveTo(mx(g.ax), my(g.ay));
    mctx.lineTo(mx(g.bx), my(g.by));
  }
  mctx.stroke();
  mctx.fillStyle = 'rgba(108,196,255,0.9)';
  mctx.fillRect(mx(PUDDLE.x0), my(PUDDLE.y1) - 1, (PUDDLE.x1 - PUDDLE.x0) * k, 3);
  if (quakeOn) {
    mctx.fillStyle = 'rgba(255,107,107,0.25)';
    mctx.beginPath();
    mctx.arc(mx(QUAKE.x), my(QUAKE.y), QUAKE.r * k, 0, Math.PI * 2);
    mctx.fill();
  }
  for (const st of city.stores) {
    mctx.fillStyle = TEAM[st.color] ?? '#fff';
    mctx.beginPath();
    mctx.arc(mx(st.x), my(st.y), 4, 0, Math.PI * 2);
    mctx.fill();
  }
  if (showCars) {
    mctx.fillStyle = 'rgba(200,208,222,0.55)';
    for (const c of cars) mctx.fillRect(mx(c.x) - 1, my(c.y) - 1, 2, 2);
  }
  if (follow) {
    mctx.strokeStyle = 'rgba(255,255,255,0.35)';
    mctx.lineWidth = 1;
    mctx.strokeRect(mx(cam.x - w / 2 / cam.s), my(cam.y + h / 2 / cam.s), (w / cam.s) * k, (h / cam.s) * k);
  }
  const b = bike();
  const hd = lerpAngle(prevBike.heading, b.heading, alpha);
  mctx.save();
  mctx.translate(mx(lerp(prevBike.x, b.x, alpha)), my(lerp(prevBike.y, b.y, alpha)));
  mctx.rotate(-hd);
  mctx.fillStyle = '#5fe3a8';
  mctx.beginPath();
  mctx.moveTo(6, 0);
  mctx.lineTo(-4, 4);
  mctx.lineTo(-2, 0);
  mctx.lineTo(-4, -4);
  mctx.closePath();
  mctx.fill();
  mctx.restore();
}

const ui = {
  dash: $('dash'),
  gauge: $('gauge'),
  fill: $('gauge-fill'),
  mark: $('gauge-mark'),
  kmh: $('kmh'),
  mps: $('mps'),
  ground: $('ground'),
  leanBar: $('lean-bar'),
  lean: $('lean'),
  slipBar: $('slip-bar'),
  slip: $('slip'),
  gripBar: $('grip-bar'),
  grip: $('grip'),
  heading: $('heading'),
  tick: $('tick'),
  top: $('p-top'),
  pGrip: $('p-grip'),
  factor: $('p-factor'),
  quake: $('p-quake'),
  cars: $('p-cars'),
  cam: $('p-cam'),
  mini: $('mini'),
  pause: $('pause'),
};

function arcPoint(frac: number): P {
  const a = ((150 + 240 * frac) * Math.PI) / 180;
  return { x: 110 + 58 * Math.cos(a), y: 72 + 58 * Math.sin(a) };
}

function updateHud(): void {
  const b = bike();
  const p = m1.physics.params;
  const sliding = b.sliding && !b.fallen;
  ui.dash.classList.toggle('sliding', sliding);
  ui.gauge.classList.toggle('sliding', sliding);
  const gaugeMax = p.topSpeed * speedFactor > 28 ? 90 : 30;
  ui.fill.setAttribute('stroke-dasharray', `${clamp(b.speed / gaugeMax, 0, 1) * 100} 100`);
  const mark = arcPoint(clamp((p.topSpeed * speedFactor) / gaugeMax, 0, 1));
  ui.mark.setAttribute('cx', mark.x.toFixed(1));
  ui.mark.setAttribute('cy', mark.y.toFixed(1));
  ui.kmh.textContent = String(Math.round(b.speed * 3.6));
  ui.mps.textContent = b.speed.toFixed(1);

  const ground = inPuddle(b.x, b.y) ? 'puddle' : inQuake(b.x, b.y) ? 'quake' : 'road';
  ui.ground.className = `chip ${ground}`;
  const wait = standUpAt === null ? 0 : Math.max(0, (standUpAt - m1.tick) / 30);
  ui.ground.textContent = b.fallen ? `fallen, up in ${wait.toFixed(1)} s` : ground === 'quake' ? 'earthquake' : ground;
  if (b.fallen) ui.ground.className = 'chip quake';

  const lean = clamp(b.lean / MAX_LEAN, -1, 1);
  ui.leanBar.style.left = `${50 + Math.min(0, lean) * 50}%`;
  ui.leanBar.style.width = `${Math.abs(lean) * 50}%`;
  ui.lean.textContent = `${Math.abs(deg(b.lean))}° ${b.lean > 0.01 ? 'R' : b.lean < -0.01 ? 'L' : ''}`.trim();
  ui.slipBar.style.width = `${clamp(Math.abs(b.slip) / 6, 0, 1) * 100}%`;
  ui.slip.textContent = Math.abs(b.slip).toFixed(2);
  const grip = testGround(b.x, b.y, p).grip;
  ui.gripBar.style.width = `${clamp(grip / 1.5, 0, 1) * 100}%`;
  ui.gripBar.style.background = ground === 'puddle' ? 'var(--water)' : ground === 'quake' ? 'var(--danger)' : '';
  ui.grip.textContent = grip.toFixed(2);
  ui.heading.textContent = `${(deg(b.heading) + 360) % 360}°`;

  ui.tick.textContent = `tick ${m1.tick}`;
  ui.top.textContent = `${p.topSpeed} m/s`;
  ui.pGrip.textContent = p.grip.toFixed(1);
  ui.factor.textContent = `×${speedFactor.toFixed(1)}`;
  ui.quake.textContent = quakeOn ? 'on' : 'off';
  ui.quake.className = `v ${quakeOn ? 'on' : 'off'}`;
  ui.cars.textContent = showCars ? String(cars.length) : 'hidden';
  ui.cars.className = `v num ${showCars ? '' : 'off'}`;
  ui.cam.textContent = follow ? 'follow' : 'city';
  ui.mini.classList.toggle('hidden', !follow);
  ui.pause.classList.toggle('show', paused);
}

function draw(alpha: number, dt: number, time: number): void {
  const city = m1.city;
  const b = bike();
  const bx = lerp(prevBike.x, b.x, alpha);
  const by = lerp(prevBike.y, b.y, alpha);
  const hd = lerpAngle(prevBike.heading, b.heading, alpha);
  const ahead = Math.min(b.speed, 20) * 0.9;
  const target = follow
    ? { x: bx + Math.cos(hd) * ahead, y: by + Math.sin(hd) * ahead, s: zoom }
    : { x: city.size / 2, y: -city.size / 2, s: Math.min(w, h) / (city.size + 90) };
  const k = 1 - Math.exp(-dt * (follow ? 6 : 4));
  cam.x = lerp(cam.x, target.x, k);
  cam.y = lerp(cam.y, target.y, k);
  cam.s = Math.exp(lerp(Math.log(cam.s), Math.log(target.s), k));

  const shake = inQuake(b.x, b.y) && !paused ? 1 - Math.hypot(b.x - QUAKE.x, b.y - QUAKE.y) / QUAKE.r : 0;
  const ox = shake * 5 * (Math.sin(time * 0.047) + Math.sin(time * 0.091) * 0.6);
  const oy = shake * 5 * (Math.cos(time * 0.053) + Math.sin(time * 0.077) * 0.6);
  S = cam.s;
  sx = (x) => (x - cam.x) * S + w / 2 + ox;
  sy = (y) => -(y - cam.y) * S + h / 2 + oy;
  centre.x = w / 2 + ox;
  centre.y = h / 2 + oy;

  ctx.fillStyle = '#0f1115';
  ctx.fillRect(0, 0, w, h);
  drawGround(city);
  drawMarkings(city);
  drawPuddle(time);
  drawTracks();
  drawStores(city, time);
  if (showCars) drawCars(alpha, time);
  drawBike(alpha, time);
  drawBuildings();
  drawQuake(time);
  drawVignette();
  if (follow) drawMini(city, alpha);
  updateHud();
}

resize();
reset();

let last = performance.now();
let acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt;
  let steps = 0;
  while (acc >= m1.dt && steps < 5) {
    if (!paused) stepOnce();
    acc -= m1.dt;
    steps++;
  }
  if (steps === 5) acc = 0;
  draw(paused ? 1 : clamp(acc / m1.dt, 0, 1), dt, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
