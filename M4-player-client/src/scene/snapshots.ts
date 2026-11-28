import type { SceneCar, ScenePlayer } from "./types.ts";

export const RENDER_DELAY_S = 0.1;
const KEEP = 12;

interface Snapshot<T> {
  t: number;
  items: Map<number, T>;
}

export type Blend<T> = (a: T, b: T, k: number) => T;

export class SnapshotBuffer<T extends { id: number }> {
  private readonly list: Snapshot<T>[] = [];
  private offset: number | null = null;
  private readonly blend: Blend<T>;
  readonly delay: number;

  constructor(blend: Blend<T>, delay = RENDER_DELAY_S) {
    this.blend = blend;
    this.delay = delay;
  }

  push(serverTime: number, items: readonly T[], localTime: number): void {
    const last = this.list[this.list.length - 1];
    if (last && serverTime <= last.t) return;
    this.list.push({ t: serverTime, items: new Map(items.map((i) => [i.id, i])) });
    if (this.list.length > KEEP) this.list.shift();
    const seen = localTime - serverTime;
    if (this.offset === null || seen < this.offset) this.offset = seen;
    else this.offset += (seen - this.offset) * 0.02;
  }

  sample(localTime: number): T[] {
    if (this.list.length === 0 || this.offset === null) return [];
    const t = localTime - this.offset - this.delay;
    const first = this.list[0];
    const last = this.list[this.list.length - 1];
    if (t <= first.t) return [...first.items.values()];
    if (t >= last.t) return [...last.items.values()];
    let i = this.list.length - 2;
    while (i > 0 && this.list[i].t > t) i--;
    const a = this.list[i];
    const b = this.list[i + 1];
    const k = (t - a.t) / (b.t - a.t);
    const out: T[] = [];
    for (const [id, nb] of b.items) {
      const na = a.items.get(id);
      out.push(na ? this.blend(na, nb, k) : nb);
    }
    return out;
  }

  clear(): void {
    this.list.length = 0;
    this.offset = null;
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function lerpHeading(a: number, b: number, k: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * k + 360) % 360;
}

export const blendPlayer: Blend<ScenePlayer> = (a, b, k) => ({
  ...b,
  x: lerp(a.x, b.x, k),
  z: lerp(a.z, b.z, k),
  heading: lerpHeading(a.heading, b.heading, k),
  lean: lerp(a.lean, b.lean, k),
  speed: lerp(a.speed, b.speed, k),
});

export const blendCar: Blend<SceneCar> = (a, b, k) => ({
  ...b,
  x: lerp(a.x, b.x, k),
  z: lerp(a.z, b.z, k),
  heading: lerpHeading(a.heading, b.heading, k),
});
