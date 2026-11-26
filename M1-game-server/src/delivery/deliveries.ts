// Delivery and scoring (M1-3, issue #31; module document 5.5 "Deliveries and points").
//
// A player gets a package automatically inside the area of the own team's
// store. Then a delivery point is chosen from the travel time table of M3: the
// points are sorted by time and cut in the middle into a near and a far half,
// and the admin's far chance of the player picks the half. Two players never
// get the same point at the same time. The points are base + bonus × expected
// time, fixed when the point is chosen. When the player stops inside the
// delivery area, the package is delivered automatically.
//
// Time comes only from the tick number given by the game loop (M1-1), and
// random numbers only from the shared seeded generator. The loop gives the
// tick of the game clock, so a pause stops the "Find me" waiting time too.

import { candidatePositions } from "./candidates.js";
import type {
  DeliveryCityPlan,
  DeliveryEvent,
  ParamSource,
  PlayerDelivery,
  PlayerView,
  Point,
  RandomSource,
  TravelTimeTable,
} from "./types.js";

/** Below this speed a player counts as stopped, m/s. */
export const STOP_SPEED_MPS = 0.5;
/** The LED of the player flashes white for this long (module document 8.5). */
export const FIND_ME_FLASH_S = 1;
/** Waiting time between two "Find me" presses (decision D8). */
export const FIND_ME_COOLDOWN_S = 5;

interface Rider {
  id: number;
  team: number;
  candidate: number | null;
  points: number;
  expectedTime_s: number;
  pickedAtTick: number;
  findMeUntilTick: number;
  findMeReadyAtTick: number;
}

export interface DeliveryDeps {
  plan: DeliveryCityPlan;
  params: ParamSource;
  rng: RandomSource;
  ticksPerSecond?: number;
}

export class Deliveries {
  private readonly plan: DeliveryCityPlan;
  private readonly params: ParamSource;
  private readonly rng: RandomSource;
  private readonly tps: number;
  private readonly positions: Map<number, Point>;
  private readonly riders = new Map<number, Rider>();
  private teamScores = [0, 0, 0, 0];

  constructor(deps: DeliveryDeps) {
    this.plan = deps.plan;
    this.params = deps.params;
    this.rng = deps.rng;
    this.tps = deps.ticksPerSecond ?? 30;
    this.positions = candidatePositions(deps.plan);
  }

  addPlayer(id: number, team: number): void {
    this.riders.set(id, {
      id,
      team,
      candidate: null,
      points: 0,
      expectedTime_s: 0,
      pickedAtTick: 0,
      findMeUntilTick: 0,
      findMeReadyAtTick: 0,
    });
  }

  /** The player leaves the game; its delivery point becomes free. */
  removePlayer(id: number): void {
    this.riders.delete(id);
  }

  /** New game: no packages, no points. Players stay. */
  reset(): void {
    this.teamScores = [0, 0, 0, 0];
    for (const r of this.riders.values()) {
      r.candidate = null;
      r.points = 0;
      r.findMeUntilTick = 0;
      r.findMeReadyAtTick = 0;
    }
  }

  /** "Find me" was pressed in this tick. False while the player still has to wait. */
  findMe(tick: number, id: number): boolean {
    const r = this.riders.get(id);
    if (!r || tick < r.findMeReadyAtTick) return false;
    r.findMeUntilTick = tick + Math.round(FIND_ME_FLASH_S * this.tps);
    r.findMeReadyAtTick = tick + Math.round(FIND_ME_COOLDOWN_S * this.tps);
    return true;
  }

  /** Pickups and deliveries of one tick. `travel` gives the travel time table of a team. */
  update(tick: number, players: readonly PlayerView[], travel: (team: number) => TravelTimeTable): DeliveryEvent[] {
    const events: DeliveryEvent[] = [];
    const ordered = [...players].sort((a, b) => a.id - b.id);
    for (const p of ordered) {
      const r = this.riders.get(p.id);
      if (!r || p.fallen) continue;

      if (r.candidate === null) {
        const store = this.plan.stores[r.team].pickup;
        if (Math.hypot(p.x - store.x, p.z - store.z) > store.radius_m) continue;
        const choice = this.choosePoint(r, travel(r.team));
        if (!choice) continue; // no free point now; the player waits at the store
        r.candidate = choice.candidate;
        r.points = choice.points;
        r.expectedTime_s = choice.time;
        r.pickedAtTick = tick;
        events.push({ type: "picked_up", player: r.id, team: r.team, candidate: choice.candidate, points: choice.points, far: choice.far });
        continue;
      }

      const point = this.positions.get(r.candidate)!;
      const radius = this.params.get("game.delivery_radius_m");
      if (Math.hypot(p.x - point.x, p.z - point.z) <= radius && p.speed < STOP_SPEED_MPS) {
        this.teamScores[r.team] += r.points;
        events.push({
          type: "delivered",
          player: r.id,
          team: r.team,
          candidate: r.candidate,
          points: r.points,
          time_s: (tick - r.pickedAtTick) / this.tps,
        });
        r.candidate = null;
        r.points = 0;
        r.expectedTime_s = 0;
      }
    }
    return events;
  }

  /** Delivery state of a player for the game state. */
  player(id: number, tick: number): PlayerDelivery {
    const r = this.riders.get(id);
    if (!r) throw new Error(`unknown player ${id}`);
    const store = this.plan.stores[r.team].pickup;
    const target = r.candidate === null ? { x: store.x, z: store.z } : this.positions.get(r.candidate)!;
    return {
      hasPackage: r.candidate !== null,
      candidate: r.candidate,
      points: r.points,
      expectedTime_s: r.expectedTime_s,
      compassTarget: { x: target.x, z: target.z },
      findMeWait_s: Math.max(0, (r.findMeReadyAtTick - tick) / this.tps),
      findMeActive: tick < r.findMeUntilTick,
    };
  }

  /** Points of the four teams. */
  scores(): number[] {
    return [...this.teamScores];
  }

  /** Position of a delivery point. */
  position(candidate: number): Point {
    const p = this.positions.get(candidate);
    if (!p) throw new Error(`unknown delivery candidate ${candidate}`);
    return p;
  }

  private choosePoint(r: Rider, table: TravelTimeTable): { candidate: number; points: number; time: number; far: boolean } | null {
    const taken = new Set<number>();
    for (const o of this.riders.values()) if (o.id !== r.id && o.candidate !== null) taken.add(o.candidate);

    const free: { id: number; time: number }[] = [];
    for (const [key, time] of Object.entries(table.times_s)) {
      const id = Number(key);
      if (time === null || !Number.isFinite(time) || taken.has(id) || !this.positions.has(id)) continue;
      free.push({ id, time });
    }
    if (free.length === 0) return null;
    free.sort((a, b) => a.time - b.time || a.id - b.id);

    // Cut in the middle: the near half gets the middle point when the count is odd.
    const cut = Math.ceil(free.length / 2);
    const near = free.slice(0, cut);
    const farHalf = free.slice(cut);
    const far = this.rng.next() < this.params.get(`players.${r.id}.far_chance`) && farHalf.length > 0;
    const pool = far ? farHalf : near;
    const pick = pool[Math.min(pool.length - 1, Math.floor(this.rng.next() * pool.length))];

    const base = this.params.get("game.delivery_base");
    const bonus = this.params.get("game.delivery_bonus");
    return { candidate: pick.id, points: Math.round(base + bonus * pick.time), time: pick.time, far };
  }
}
