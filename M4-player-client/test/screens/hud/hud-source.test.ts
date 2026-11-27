// Run from the repository root:
//   node --test "M4-player-client/test/screens/**/*.test.ts"
import assert from "node:assert/strict";
import { test } from "node:test";
import { toHudFrame, type GameStateGuess } from "../../../src/screens/hud/hud-source.ts";

/** A state shaped like the GameState of PR #78 (with the fields that the HUD does not read). */
const FULL = {
  tick: 1200,
  phase: "playing",
  gameTimeSeconds: 40,
  remainingSeconds: 260,
  players: [
    { index: 0, team: 0, name: "Ayşe", isBot: false, connected: true, penaltySeconds: 0,
      pose: { x: 1, y: 2, angle: 0, speed: 0, lean: 0, sliding: false, fallen: false },
      delivery: { hasPackage: false, targetPoint: -1, targetPoints: 0, compassX: 0, compassY: 0, findMeCooldown: 0 } },
    { index: 3, team: 1, name: "Can", isBot: false, connected: true, penaltySeconds: 2.4,
      pose: { x: 5, y: 6, angle: 1, speed: 3, lean: 0, sliding: false, fallen: true },
      delivery: { hasPackage: true, targetPoint: 7, targetPoints: 120, compassX: 90, compassY: 40, findMeCooldown: 45 } },
  ],
  scores: [
    { team: 0, score: 10 },
    { team: 1, score: 25 },
    { team: 2, score: 5 },
    { team: 3, score: 0 },
  ],
  obstacles: [],
  obstacleVersion: 0,
  quake: null,
  npcCars: [],
} satisfies GameStateGuess & Record<string, unknown>;

const DEFAULTS = {
  remainingSeconds: 0,
  scores: [0, 0, 0, 0],
  myTeam: null,
  hasPackage: false,
  penaltySeconds: 0,
  findMeCooldownTicks: 0,
};

test("a good state gives the frame of the own player", () => {
  assert.deepEqual(toHudFrame(FULL, 3), {
    remainingSeconds: 260,
    scores: [10, 25, 5, 0],
    myTeam: 1,
    hasPackage: true,
    penaltySeconds: 2.4,
    findMeCooldownTicks: 45,
  });
});

test("the player is found by its index, not by its place in the list", () => {
  assert.equal(toHudFrame(FULL, 0).myTeam, 0);
  assert.equal(toHudFrame(FULL, 0).hasPackage, false);
  assert.equal(toHudFrame(FULL, 3).myTeam, 1);
});

test("a team that is missing in the scores gets 0", () => {
  const frame = toHudFrame({ scores: [{ team: 2, score: 7 }] }, 0);
  assert.deepEqual(frame.scores, [0, 0, 7, 0]);
});

test("a team number that is not 0-3 is ignored", () => {
  const frame = toHudFrame({ scores: [{ team: 4, score: 9 }, { team: -1, score: 9 }, { team: 1.5, score: 9 }, { team: 3, score: 2 }] }, 0);
  assert.deepEqual(frame.scores, [0, 0, 0, 2]);
});

test("NaN, negative and wrong values fall back to the safe default and never throw", () => {
  const bad = {
    remainingSeconds: Number.NaN,
    scores: [{ team: 0, score: Number.NaN }, { team: 1, score: -5 }, { team: 2, score: Infinity }, { team: 3, score: "9" as unknown as number }],
    players: [{ index: 0, team: 0, penaltySeconds: -3, delivery: { hasPackage: "yes" as unknown as boolean, findMeCooldown: Number.NaN } }],
  };
  assert.deepEqual(toHudFrame(bad, 0), { ...DEFAULTS, myTeam: 0 });
});

test("a decimal score is cut down and a decimal cooldown is rounded up", () => {
  const frame = toHudFrame(
    { scores: [{ team: 0, score: 7.9 }], players: [{ index: 0, team: 0, delivery: { findMeCooldown: 10.2 } }] },
    0,
  );
  assert.equal(frame.scores[0], 7);
  assert.equal(frame.findMeCooldownTicks, 11);
});

test("an empty player list gives no team and no package", () => {
  const frame = toHudFrame({ remainingSeconds: 100, scores: [{ team: 0, score: 3 }], players: [] }, 0);
  assert.deepEqual(frame, { ...DEFAULTS, remainingSeconds: 100, scores: [3, 0, 0, 0] });
});

test("a player index that is not in the list gives no team", () => {
  assert.equal(toHudFrame(FULL, 7).myTeam, null);
  assert.equal(toHudFrame(FULL, -1).myTeam, null);
});

test("an invalid team of the own player gives null", () => {
  assert.equal(toHudFrame({ players: [{ index: 0, team: 9 }] }, 0).myTeam, null);
});

test("an empty, missing or wrong state gives the defaults", () => {
  assert.deepEqual(toHudFrame({}, 0), DEFAULTS);
  assert.deepEqual(toHudFrame(null, 0), DEFAULTS);
  assert.deepEqual(toHudFrame(undefined, 0), DEFAULTS);
  assert.deepEqual(toHudFrame({ scores: "x" as unknown as [], players: 5 as unknown as [] }, 0), DEFAULTS);
});

test("an entry that is null in the lists does not break it", () => {
  const frame = toHudFrame(
    { scores: [null, { team: 1, score: 4 }] as unknown as [], players: [null, { index: 2, team: 3 }] as unknown as [] },
    2,
  );
  assert.deepEqual(frame.scores, [0, 4, 0, 0]);
  assert.equal(frame.myTeam, 3);
});

test("the same state gives the same frame", () => {
  assert.deepEqual(toHudFrame(FULL, 3), toHudFrame(FULL, 3));
});
