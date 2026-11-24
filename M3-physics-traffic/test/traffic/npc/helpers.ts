import type { Obstacle, PlayerPose } from '../../../src/common/types';
import type { CarHit, NpcCarPose, TrafficOutput, TrafficParams } from '../../../src/traffic/npc';
import type { NpcTraffic } from '../../../src/traffic/npc';

export const DT = 1 / 30;

export interface TickInput {
  players?: PlayerPose[];
  obstacles?: Obstacle[];
  carHits?: CarHit[];
  params?: Partial<TrafficParams>;
}

/** Runs n ticks; onTick can check each output and give the next inputs. */
export function run(
  traffic: NpcTraffic,
  ticks: number,
  input: (tick: number) => TickInput = () => ({}),
  onTick?: (out: TrafficOutput, tick: number) => void,
): TrafficOutput {
  let out!: TrafficOutput;
  for (let t = 0; t < ticks; t++) {
    const i = input(t);
    out = traffic.step({
      dt: DT,
      players: i.players ?? [],
      obstacles: i.obstacles ?? [],
      carHits: i.carHits ?? [],
      params: i.params,
    });
    onTick?.(out, t);
  }
  return out;
}

export function player(id: number, x: number, y: number, heading = 0, speed = 0): PlayerPose {
  return { id, x, y, heading, speed, fallen: false };
}

/** Smallest distance between the centres of two cars that are on the road. */
export function minCarDistance(cars: readonly NpcCarPose[]): number {
  let min = Infinity;
  const on = cars.filter((c) => c.state !== 'offroad');
  for (let i = 0; i < on.length; i++) {
    for (let j = i + 1; j < on.length; j++) {
      const d = Math.hypot(on[i].x - on[j].x, on[i].y - on[j].y);
      if (d < min) min = d;
    }
  }
  return min;
}

/** Cars on the same edge and lane must not overlap (bumper to bumper gap >= 0). */
export function minSameLaneGap(cars: readonly NpcCarPose[]): number {
  const byLane = new Map<string, NpcCarPose[]>();
  for (const c of cars) {
    if (c.edgeId === null || c.state === 'offroad') continue;
    const key = `${c.edgeId}:${c.lane}`;
    const list = byLane.get(key) ?? [];
    list.push(c);
    byLane.set(key, list);
  }
  let min = Infinity;
  for (const list of byLane.values()) {
    // Along the lane, distance is the projection on the heading.
    const h = list[0].heading;
    const hx = Math.cos(h);
    const hy = Math.sin(h);
    list.sort((a, b) => a.x * hx + a.y * hy - (b.x * hx + b.y * hy));
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      const along = (b.x - a.x) * hx + (b.y - a.y) * hy;
      const gap = along - (a.length + b.length) / 2;
      if (gap < min) min = gap;
    }
  }
  return min;
}
