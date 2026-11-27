// TAHMİN: #78'in şekli, #35 ile kesinleşecek.
//
// The HUD reads one small frame (`HudFrame`). This file makes it from the game
// state that PR #78 (M1-1) builds in `state-builder.ts` (`GameState`, lines
// 20-43) and `loop/types.ts` (`DeliveryState`, lines 165-172). Only the fields
// that the HUD needs are in the type below, so the real `GameState` fits it.
//
// Units in #78: `remainingSeconds` and `penaltySeconds` are seconds,
// `findMeCooldown` is in ticks. PR #72 (the fake server of M4-2) has another
// shape (`timeLeftSeconds`, `scores` as a list of numbers, `findMeWaitSeconds`),
// so when the real message exists, only this file changes.
//
// A missing or wrong value (NaN, a negative number, a wrong type) never throws:
// it falls back to a safe default, because a bad state must not break the screen.

import { TEAMS } from "../lobby-model.ts";
import type { HudFrame, TeamId, TeamScores } from "../placeholder-types.ts";

export interface PlayerGuess {
  index?: number;
  team?: number;
  penaltySeconds?: number;
  delivery?: {
    hasPackage?: boolean;
    /** Ticks left. */
    findMeCooldown?: number;
  };
}

export interface GameStateGuess {
  remainingSeconds?: number;
  scores?: readonly { team?: number; score?: number }[];
  players?: readonly PlayerGuess[];
}

/** A number that is finite and not negative, or 0. */
function safe(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function teamOf(value: unknown): TeamId | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < TEAMS.length
    ? (value as TeamId)
    : null;
}

/** `{team, score}` list -> points by team number. A team that is missing or wrong gets 0. */
function scoresOf(list: unknown): TeamScores {
  const scores = TEAMS.map(() => 0);
  if (!Array.isArray(list)) return scores;
  for (const entry of list) {
    const team = teamOf(entry?.team);
    if (team !== null) scores[team] = Math.floor(safe(entry?.score));
  }
  return scores;
}

export function toHudFrame(state: GameStateGuess | null | undefined, myPlayerIndex: number): HudFrame {
  const players: readonly PlayerGuess[] = Array.isArray(state?.players) ? state.players : [];
  const me = players.find((p) => p?.index === myPlayerIndex);
  return {
    remainingSeconds: safe(state?.remainingSeconds),
    scores: scoresOf(state?.scores),
    myTeam: teamOf(me?.team),
    hasPackage: me?.delivery?.hasPackage === true,
    penaltySeconds: safe(me?.penaltySeconds),
    findMeCooldownTicks: Math.ceil(safe(me?.delivery?.findMeCooldown)),
  };
}
