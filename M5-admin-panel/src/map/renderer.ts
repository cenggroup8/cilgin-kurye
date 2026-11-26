// Canvas 2D renderer for the admin live map (M5-3).

import {
  GRID_LINES, NODES, SEGMENTS, STORES, TEAM_COLORS,
  SEGMENT_LENGTH, segmentToWorld, WORLD_SIZE,
} from './city.ts';
import { LANE_WIDTH, LANES_PER_DIR, PITCH, ROAD_HALF } from './grid-constants.ts';
import type { AdminState } from '../comm/protocol.ts';
import type { HitResult, ObstacleType } from './types.ts';

const ROAD_WIDTH = ROAD_HALF * 2;              // 14 m
const BG_COLOR = '#2e4a2e';
const ROAD_COLOR = '#3a3a3a';
const LANE_DASH = [4, 6];                      // in metres — scaled later
const LANE_CENTER_COLOR = '#cccc44';
const LANE_EDGE_COLOR = '#cccccc';

const OBSTACLE_COLORS: Record<ObstacleType, string> = {
  heavy_traffic: '#fdd835',
  road_work: '#ff9800',
  accident: '#f44336',
  puddle: '#42a5f5',
};

export class MapRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oz = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    // Fit the 500 m city into the canvas with some padding.
    const pad = 20 * dpr;
    this.scale = Math.min((this.canvas.width - pad * 2) / WORLD_SIZE, (this.canvas.height - pad * 2) / WORLD_SIZE);
    this.ox = (this.canvas.width - WORLD_SIZE * this.scale) / 2;
    this.oz = (this.canvas.height - WORLD_SIZE * this.scale) / 2;
  }

  /** Convert world metres to canvas pixels. */
  private wx(x: number): number { return this.ox + x * this.scale; }
  private wz(z: number): number { return this.oz + z * this.scale; }
  private wLen(m: number): number { return m * this.scale; }

  /** Convert canvas (clientX, clientY relative to canvas) to world (x, z). */
  canvasToWorld(clientX: number, clientY: number): { x: number; z: number } {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cx = (clientX - rect.left) * dpr;
    const cy = (clientY - rect.top) * dpr;
    return {
      x: (cx - this.ox) / this.scale,
      z: (cy - this.oz) / this.scale,
    };
  }

  draw(state: AdminState | null, activeTool: string | null, hoverHit: HitResult | null): void {
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // 1. Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // 2. Roads
    this.drawRoads();

    // 3. Intersections
    this.drawIntersections();

    // 4. Lane markings
    this.drawLaneMarkings();

    // 5. Stores
    this.drawStores();

    if (!state) return;

    // 6. Delivery points
    for (const dp of state.deliveryPoints) {
      this.drawDiamond(dp.x, dp.z, 6, '#ff9800');
    }

    // 7. Obstacles
    for (const obs of state.obstacles) {
      const { x, z } = segmentToWorld(obs.segment, obs.lane, obs.pos);
      this.drawObstacle(x, z, obs.type as ObstacleType);
    }

    // 8. NPC cars
    for (const car of state.npcCars) {
      this.drawRect(car.x, car.z, 3, 2, '#78909c');
    }

    // 9. Players
    for (const p of state.players) {
      const color = TEAM_COLORS[p.team] ?? '#ffffff';
      if (p.fallen) {
        this.drawX(p.x, p.z, 5, '#f44336');
      }
      this.drawCircle(p.x, p.z, 4, color);
      // Player id label
      ctx.fillStyle = '#ffffff';
      ctx.font = `${Math.max(10, this.wLen(3))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(p.id), this.wx(p.x), this.wz(p.z));
    }

    // 10. Hover highlight
    if (hoverHit && activeTool) {
      this.drawHoverHighlight(hoverHit);
    }
  }

  // ── Layer helpers ───────────────────────────────────────────────

  private drawRoads(): void {
    const { ctx } = this;
    ctx.fillStyle = ROAD_COLOR;
    for (const seg of SEGMENTS) {
      if (seg.dir === 'EW') {
        ctx.fillRect(
          this.wx(seg.ax), this.wz(seg.az - ROAD_HALF),
          this.wLen(SEGMENT_LENGTH), this.wLen(ROAD_WIDTH),
        );
      } else {
        ctx.fillRect(
          this.wx(seg.ax - ROAD_HALF), this.wz(seg.az),
          this.wLen(ROAD_WIDTH), this.wLen(SEGMENT_LENGTH),
        );
      }
    }
  }

  private drawIntersections(): void {
    const { ctx } = this;
    ctx.fillStyle = ROAD_COLOR;
    for (const node of NODES) {
      ctx.fillRect(
        this.wx(node.x - ROAD_HALF), this.wz(node.z - ROAD_HALF),
        this.wLen(ROAD_WIDTH), this.wLen(ROAD_WIDTH),
      );
    }
  }

  private drawLaneMarkings(): void {
    const { ctx } = this;
    const dash = LANE_DASH.map((d) => this.wLen(d));

    for (const seg of SEGMENTS) {
      // Centre line (yellow, solid)
      ctx.strokeStyle = LANE_CENTER_COLOR;
      ctx.lineWidth = Math.max(1, this.wLen(0.3));
      ctx.setLineDash([]);
      this.strokeSegmentLine(seg, 0);

      // Edge lane dividers (white, dashed)
      ctx.strokeStyle = LANE_EDGE_COLOR;
      ctx.lineWidth = Math.max(1, this.wLen(0.2));
      ctx.setLineDash(dash);
      for (const offset of [LANE_WIDTH, -LANE_WIDTH]) {
        this.strokeSegmentLine(seg, offset);
      }
    }
    ctx.setLineDash([]);
  }

  private strokeSegmentLine(seg: typeof SEGMENTS[number], perpOffset: number): void {
    const { ctx } = this;
    ctx.beginPath();
    if (seg.dir === 'EW') {
      ctx.moveTo(this.wx(seg.ax), this.wz(seg.az + perpOffset));
      ctx.lineTo(this.wx(seg.bx), this.wz(seg.bz + perpOffset));
    } else {
      ctx.moveTo(this.wx(seg.ax - perpOffset), this.wz(seg.az));
      ctx.lineTo(this.wx(seg.bx - perpOffset), this.wz(seg.bz));
    }
    ctx.stroke();
  }

  private drawStores(): void {
    const size = 12;
    for (const store of STORES) {
      this.drawRect(store.x, store.z, size, size, store.color);
    }
  }

  private drawObstacle(x: number, z: number, type: ObstacleType): void {
    const color = OBSTACLE_COLORS[type] ?? '#ffffff';
    const { ctx } = this;
    const r = this.wLen(3);
    const px = this.wx(x);
    const pz = this.wz(z);

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    switch (type) {
      case 'heavy_traffic':
        // Triangle
        ctx.beginPath();
        ctx.moveTo(px, pz - r);
        ctx.lineTo(px - r, pz + r);
        ctx.lineTo(px + r, pz + r);
        ctx.closePath();
        ctx.fill();
        break;
      case 'road_work':
        // Diamond
        ctx.beginPath();
        ctx.moveTo(px, pz - r);
        ctx.lineTo(px + r, pz);
        ctx.lineTo(px, pz + r);
        ctx.lineTo(px - r, pz);
        ctx.closePath();
        ctx.fill();
        break;
      case 'accident':
        // Circle
        ctx.beginPath();
        ctx.arc(px, pz, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'puddle':
        // Oval
        ctx.beginPath();
        ctx.ellipse(px, pz, r * 1.3, r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
    ctx.globalAlpha = 1;
  }

  private drawHoverHighlight(hit: HitResult): void {
    const { ctx } = this;
    const seg = SEGMENTS.find((s) => s.id === hit.segment);
    if (!seg) return;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, this.wLen(1));
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([]);

    if (hit.lane === 0) {
      // Highlight whole segment
      if (seg.dir === 'EW') {
        ctx.strokeRect(
          this.wx(seg.ax), this.wz(seg.az - ROAD_HALF),
          this.wLen(SEGMENT_LENGTH), this.wLen(ROAD_WIDTH),
        );
      } else {
        ctx.strokeRect(
          this.wx(seg.ax - ROAD_HALF), this.wz(seg.az),
          this.wLen(ROAD_WIDTH), this.wLen(SEGMENT_LENGTH),
        );
      }
    } else {
      // Highlight one lane
      const { x, z } = segmentToWorld(seg.id, hit.lane, 0.5);
      if (seg.dir === 'EW') {
        ctx.strokeRect(
          this.wx(seg.ax), this.wz(z - LANE_WIDTH / 2),
          this.wLen(SEGMENT_LENGTH), this.wLen(LANE_WIDTH),
        );
      } else {
        ctx.strokeRect(
          this.wx(x - LANE_WIDTH / 2), this.wz(seg.az),
          this.wLen(LANE_WIDTH), this.wLen(SEGMENT_LENGTH),
        );
      }
    }

    // Crosshair at exact click point
    const cx = this.wx(hit.worldX);
    const cz = this.wz(hit.worldZ);
    const cr = this.wLen(2);
    ctx.beginPath();
    ctx.moveTo(cx - cr, cz);
    ctx.lineTo(cx + cr, cz);
    ctx.moveTo(cx, cz - cr);
    ctx.lineTo(cx, cz + cr);
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  // ── Primitive helpers ─────────────────────────────────────────

  private drawCircle(x: number, z: number, radius: number, color: string): void {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(this.wx(x), this.wz(z), this.wLen(radius), 0, Math.PI * 2);
    ctx.fill();
  }

  private drawDiamond(x: number, z: number, size: number, color: string): void {
    const { ctx } = this;
    const r = this.wLen(size / 2);
    const px = this.wx(x);
    const pz = this.wz(z);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(px, pz - r);
    ctx.lineTo(px + r, pz);
    ctx.lineTo(px, pz + r);
    ctx.lineTo(px - r, pz);
    ctx.closePath();
    ctx.fill();
  }

  private drawRect(x: number, z: number, w: number, h: number, color: string): void {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.fillRect(this.wx(x) - this.wLen(w / 2), this.wz(z) - this.wLen(h / 2), this.wLen(w), this.wLen(h));
  }

  private drawX(x: number, z: number, size: number, color: string): void {
    const { ctx } = this;
    const r = this.wLen(size / 2);
    const px = this.wx(x);
    const pz = this.wz(z);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, this.wLen(0.8));
    ctx.beginPath();
    ctx.moveTo(px - r, pz - r);
    ctx.lineTo(px + r, pz + r);
    ctx.moveTo(px + r, pz - r);
    ctx.lineTo(px - r, pz + r);
    ctx.stroke();
  }
}
