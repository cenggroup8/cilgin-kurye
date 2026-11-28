import { describe, expect, it } from "vitest";
import { loadCityPlan } from "../src/common/cityPlan.js";
import { FLAG, PHASE, Scenario } from "../src/server/scenario.js";

const plan = loadCityPlan();
const run = (s: Scenario, seconds: number) => {
  for (let i = 0; i < seconds * 30; i++) s.step(1 / 30);
};

describe("scenario", () => {
  it("goes through lobby, countdown, game and end, and starts again", () => {
    const s = new Scenario(plan, { lobbyS: 1, countdownS: 1, gameS: 2, endS: 1 });
    const seen: number[] = [];
    for (let i = 0; i < 6 * 30; i++) {
      s.step(1 / 30);
      if (seen.at(-1) !== s.phase) seen.push(s.phase);
    }
    expect(seen).toEqual([PHASE.lobby, PHASE.countdown, PHASE.game, PHASE.end, PHASE.lobby]);
  });

  it("gives the same states for the same seed", () => {
    const a = new Scenario(plan, { seed: 5, lobbyS: 0, countdownS: 0 });
    const b = new Scenario(plan, { seed: 5, lobbyS: 0, countdownS: 0 });
    run(a, 30);
    run(b, 30);
    expect(a.boardState()).toEqual(b.boardState());
  });

  it("keeps every field in the ranges of board_protocol.md", () => {
    const s = new Scenario(plan, { lobbyS: 0.5, countdownS: 0.5, gameS: 60, obstacleEveryS: 2 });
    for (let i = 0; i < 70 * 30; i++) {
      s.step(1 / 30);
      if (i % 30) continue;
      const d = s.boardState() as { ph: number; tl: number; p: number[][]; dp: number[][]; ob: number[][]; eq: number[] };
      expect(d.ph).toBeGreaterThanOrEqual(0);
      expect(d.ph).toBeLessThanOrEqual(4);
      for (const [id, team, tone, flags, u, v, heading] of d.p) {
        expect(id).toBeLessThan(8);
        expect(team).toBeLessThan(4);
        expect([0, 1]).toContain(tone);
        expect(flags).toBeLessThan(32);
        for (const x of [u, v]) expect(x >= 0 && x <= 1).toBe(true);
        expect([0, 90, 180, 270]).toContain(heading);
      }
      for (const [owner, u, v, st] of d.dp) {
        expect(owner).toBeLessThan(8);
        expect(u >= 0 && u <= 1 && v >= 0 && v <= 1).toBe(true);
        expect([0, 1]).toContain(st);
      }
      for (const [seg, type, lane] of d.ob) {
        expect(seg >= 0 && seg <= 59).toBe(true);
        expect(type >= 1 && type <= 4).toBe(true);
        expect(lane >= 0 && lane <= 4).toBe(true);
        if (type === 2) expect(lane).toBe(0);
      }
    }
  });

  it("riders stay on the roads", () => {
    const s = new Scenario(plan, { lobbyS: 0, countdownS: 0 });
    for (let i = 0; i < 60; i++) {
      run(s, 1);
      for (const p of s.boardState().p as number[][]) {
        const x = p[4] * 500;
        const z = p[5] * 500;
        const onRoad = Math.abs(x - Math.round(x / 100) * 100) < 0.5 || Math.abs(z - Math.round(z / 100) * 100) < 0.5;
        expect(onRoad).toBe(true);
      }
    }
  });

  it("pause stops everything; find me and the earthquake show up and end", () => {
    const s = new Scenario(plan, { lobbyS: 0, countdownS: 0, quakeS: 2 });
    run(s, 2);
    s.togglePause();
    const frozen = JSON.stringify(s.boardState().p);
    run(s, 2);
    expect(s.phase).toBe(PHASE.pause);
    expect(JSON.stringify(s.boardState().p)).toBe(frozen);
    s.togglePause();
    s.findMe(0);
    s.startQuake(0.5, 0.5, 7);
    expect((s.boardState().p as number[][])[0][3] & FLAG.findMe).toBe(FLAG.findMe);
    expect((s.boardState().eq as number[]).slice(0, 4)).toEqual([1, 0.5, 0.5, 7]);
    run(s, 2.5);
    expect((s.boardState().p as number[][])[0][3] & FLAG.findMe).toBe(0);
    expect(s.boardState().eq).toEqual([]);
  });
});
