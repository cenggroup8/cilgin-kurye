import { describe, expect, it } from "vitest";
import {
  candidatePositions,
  Deliveries,
  FIND_ME_COOLDOWN_S,
  type DeliveryEvent,
  type PlayerView,
} from "../src/delivery/index.js";
import { FakeParams, FakeRng, fakeTravel, PLAN } from "./delivery-fakes.js";

const TPS = 30;
const POSITIONS = candidatePositions(PLAN);

function setup(seed = 1) {
  const params = new FakeParams();
  const d = new Deliveries({ plan: PLAN, params, rng: new FakeRng(seed), ticksPerSecond: TPS });
  return { params, d };
}

/** A player standing at a place. */
function at(id: number, x: number, z: number, speed = 0, fallen = false): PlayerView {
  return { id, team: Math.floor(id / 2), x, z, speed, fallen };
}

const atStore = (id: number): PlayerView => {
  const s = PLAN.stores[Math.floor(id / 2)].pickup;
  return at(id, s.x, s.z);
};

const sortedTimes = (team: number): number[] =>
  Object.values(fakeTravel(POSITIONS)(team).times_s).filter((t): t is number => t !== null).sort((a, b) => a - b);

describe("delivery points", () => {
  it("lie at the edge of their road", () => {
    expect(POSITIONS.size).toBe(60);
    // Candidate 0: middle of segment h_0_0 (x 0 to 100, z 0), north side, 2 lanes of 3.5 m.
    expect(POSITIONS.get(0)).toEqual({ x: 50, z: -7 });
  });
});

describe("package pickup", () => {
  it("gives a package automatically inside the own store area", () => {
    const { d } = setup();
    d.addPlayer(0, 0);
    const events = d.update(0, [atStore(0)], fakeTravel(POSITIONS));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("picked_up");
    const s = d.player(0, 0);
    expect(s.hasPackage).toBe(true);
    expect(s.compassTarget).toEqual(POSITIONS.get(s.candidate!));
  });

  it("gives nothing outside the store area or to a fallen player", () => {
    const { d } = setup();
    d.addPlayer(0, 0);
    d.addPlayer(1, 0);
    const store = PLAN.stores[0].pickup;
    const events = d.update(0, [at(0, store.x + 11, store.z), { ...atStore(1), fallen: true }], fakeTravel(POSITIONS));
    expect(events).toEqual([]);
    expect(d.player(0, 0).compassTarget).toEqual({ x: store.x, z: store.z });
  });

  it("chooses a near point with far chance 0 and a far point with far chance 1", () => {
    for (const [chance, near] of [[0, true], [1, false]] as const) {
      const { d, params } = setup();
      params.set("players.0.far_chance", chance);
      const times = sortedTimes(0);
      const median = times[Math.ceil(times.length / 2) - 1];
      d.addPlayer(0, 0);
      for (let round = 0; round < 40; round++) {
        d.update(round, [atStore(0)], fakeTravel(POSITIONS));
        const t = d.player(0, round).expectedTime_s;
        expect(near ? t <= median : t > median).toBe(true);
        d.reset();
      }
    }
  });

  it("never gives the same point to two players at the same time", () => {
    const { d } = setup(5);
    for (let p = 0; p < 8; p++) d.addPlayer(p, Math.floor(p / 2));
    for (let round = 0; round < 50; round++) {
      d.update(round, Array.from({ length: 8 }, (_, p) => atStore(p)), fakeTravel(POSITIONS));
      const chosen = Array.from({ length: 8 }, (_, p) => d.player(p, round).candidate);
      expect(chosen.every((c) => c !== null)).toBe(true);
      expect(new Set(chosen).size).toBe(8);
      d.reset();
    }
  });

  it("skips points that cannot be reached", () => {
    const { d } = setup();
    const open = 17;
    const closed = new Set([...POSITIONS.keys()].filter((id) => id !== open));
    d.addPlayer(0, 0);
    d.update(0, [atStore(0)], fakeTravel(POSITIONS, closed));
    expect(d.player(0, 0).candidate).toBe(open);
  });

  it("waits at the store while no point is free, and gets one later", () => {
    const { d } = setup();
    const all = new Set(POSITIONS.keys());
    d.addPlayer(0, 0);
    expect(d.update(0, [atStore(0)], fakeTravel(POSITIONS, all))).toEqual([]);
    expect(d.player(0, 0).hasPackage).toBe(false);
    d.update(1, [atStore(0)], fakeTravel(POSITIONS));
    expect(d.player(0, 1).hasPackage).toBe(true);
  });
});

describe("points and delivery", () => {
  function picked() {
    const { d, params } = setup();
    d.addPlayer(0, 0);
    d.update(0, [atStore(0)], fakeTravel(POSITIONS));
    const s = d.player(0, 0);
    return { d, params, s, point: POSITIONS.get(s.candidate!)! };
  }

  it("fixes base + bonus × expected time when the point is chosen", () => {
    const { s } = picked();
    expect(s.points).toBe(Math.round(100 + 2 * s.expectedTime_s));
  });

  it("delivers automatically when the player stops in the area", () => {
    const { d, s, point } = picked();
    const events = d.update(90, [at(0, point.x + 1, point.z, 0.2)], fakeTravel(POSITIONS));
    expect(events).toEqual<DeliveryEvent[]>([
      { type: "delivered", player: 0, team: 0, candidate: s.candidate!, points: s.points, time_s: 3 },
    ]);
    expect(d.scores()).toEqual([s.points, 0, 0, 0]);
    const after = d.player(0, 90);
    expect(after.hasPackage).toBe(false);
    expect(after.compassTarget).toEqual({ x: PLAN.stores[0].pickup.x, z: PLAN.stores[0].pickup.z });
  });

  it("does not deliver while moving, outside the area or after a fall", () => {
    const { d, point } = picked();
    const travel = fakeTravel(POSITIONS);
    expect(d.update(1, [at(0, point.x, point.z, 3)], travel)).toEqual([]);
    expect(d.update(2, [at(0, point.x + 5, point.z, 0)], travel)).toEqual([]);
    expect(d.update(3, [at(0, point.x, point.z, 0, true)], travel)).toEqual([]);
    expect(d.player(0, 3).hasPackage).toBe(true);
  });

  it("uses the admin's delivery area size", () => {
    const { d, params, point } = picked();
    params.set("game.delivery_radius_m", 6);
    const events = d.update(1, [at(0, point.x + 5, point.z, 0)], fakeTravel(POSITIONS));
    expect(events[0]?.type).toBe("delivered");
  });

  it("keeps the given points when an obstacle changes the travel times later", () => {
    const { d, s, point } = picked();
    const slower = (team: number) => {
      const t = fakeTravel(POSITIONS)(team);
      for (const k of Object.keys(t.times_s)) t.times_s[k] = (t.times_s[k] ?? 0) * 3;
      return t;
    };
    const events = d.update(5, [at(0, point.x, point.z, 0)], slower);
    expect(events[0]).toMatchObject({ type: "delivered", points: s.points });
  });
});

describe("Find me", () => {
  it("flashes for 1 s, then waits 5 s, and two presses in one tick count once", () => {
    const { d } = setup();
    d.addPlayer(0, 0);
    expect(d.findMe(10, 0)).toBe(true);
    expect(d.findMe(10, 0)).toBe(false);
    expect(d.player(0, 10)).toMatchObject({ findMeActive: true, findMeWait_s: FIND_ME_COOLDOWN_S });
    expect(d.player(0, 10 + TPS).findMeActive).toBe(false);
    expect(d.findMe(10 + 2 * TPS, 0)).toBe(false);
    expect(d.player(0, 10 + 2 * TPS).findMeWait_s).toBeCloseTo(3, 9);
    expect(d.findMe(10 + 5 * TPS, 0)).toBe(true);
  });
});

describe("the whole delivery cycle", () => {
  /** Players ride to their point and back; returns all events. */
  function play(seed: number, rounds: number) {
    const { d } = setup(seed);
    for (let p = 0; p < 8; p++) d.addPlayer(p, Math.floor(p / 2));
    const events: DeliveryEvent[] = [];
    const travel = fakeTravel(POSITIONS);
    for (let tick = 0; tick < rounds * 2; tick++) {
      // Even ticks: everybody at the store. Odd ticks: everybody at the own point.
      const players = Array.from({ length: 8 }, (_, p) => {
        const c = d.player(p, tick).candidate;
        if (tick % 2 === 0 || c === null) return atStore(p);
        const pt = POSITIONS.get(c)!;
        return at(p, pt.x, pt.z);
      });
      events.push(...d.update(tick, players, travel));
      for (let p = 0; p < 8; p++) {
        const s = d.player(p, tick);
        // Every player always has a package or a place to go.
        expect(Number.isFinite(s.compassTarget.x) && Number.isFinite(s.compassTarget.z)).toBe(true);
      }
    }
    return { d, events };
  }

  it("is fair for the four teams in a city that is the same on all sides", () => {
    const { events } = play(3, 300);
    const delivered = events.filter((e) => e.type === "delivered");
    expect(delivered.length).toBeGreaterThan(8 * 250);
    const mean = [0, 1, 2, 3].map((team) => {
      const pts = delivered.filter((e) => e.team === team).map((e) => e.points);
      return pts.reduce((a, b) => a + b, 0) / pts.length;
    });
    const avg = mean.reduce((a, b) => a + b, 0) / 4;
    for (const m of mean) expect(Math.abs(m - avg) / avg).toBeLessThan(0.05);
  });

  it("gives exactly the same game for the same seed", () => {
    const a = play(9, 100);
    const b = play(9, 100);
    expect(a.events).toEqual(b.events);
    expect(a.d.scores()).toEqual(b.d.scores());
  });
});
