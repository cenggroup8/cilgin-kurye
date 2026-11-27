// What the HUD shows at the top of the game screen. No DOM.

import { TEAMS } from "../lobby-model.ts";
import type { TeamId, TeamScores } from "../placeholder-types.ts";
import { TEXT } from "../texts.ts";

/** "m:ss". A negative, missing or endless value shows "0:00"; a fraction is cut down. */
export function formatTime(seconds: number): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export interface HudScoreRow {
  team: TeamId;
  name: string;
  color: string;
  score: number;
  /** This is the team of this phone. */
  mine: boolean;
}

function cleanScore(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** The four teams in the order of the lobby (blue, green, purple, yellow). Not sorted by points. */
export function scoreRows(scores: TeamScores, myTeam: TeamId | null): HudScoreRow[] {
  return TEAMS.map(({ id, name, color }) => ({
    team: id,
    name,
    color,
    score: cleanScore(scores[id]),
    mine: myTeam === id,
  }));
}

/** The text of the penalty countdown, or null when the player does not wait. Seconds are rounded up. */
export function penaltyText(seconds: number): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  return TEXT.hud.penalty(Math.ceil(seconds));
}
