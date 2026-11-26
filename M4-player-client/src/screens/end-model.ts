// What the end screen shows: the winner (or a draw) and the points of all teams. No DOM.
//
// M1 decides who won, so the winners come from the state. The page only sorts
// the scores and writes the words.

import { TEAMS } from "./lobby-model.ts";
import type { TeamId, TeamScores, Winners } from "./placeholder-types.ts";
import { TEXT } from "./texts.ts";

export interface ScoreRow {
  team: TeamId;
  name: string;
  color: string;
  score: number;
  winner: boolean;
  mine: boolean;
  /** For example "Blue · 12 · Winner · Your team". */
  label: string;
}

export interface EndResult {
  /** One winning team, several winning teams (a draw), or no winner in the data. */
  kind: "win" | "draw" | "none";
  winners: TeamId[];
  headline: string;
  /** All four teams, best first; the same score keeps the team order. */
  rows: ScoreRow[];
}

function cleanScore(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** "Blue", "Blue and Green", "Blue, Green and Purple". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${TEXT.end.and} ${names[names.length - 1]}`;
}

export function endResult(scores: TeamScores, winners: Winners, myTeam: TeamId | null): EndResult {
  const winning = TEAMS.filter((t) => winners.includes(t.id));
  const winningIds = winning.map((t) => t.id);

  const rows: ScoreRow[] = TEAMS.map(({ id, name, color }) => {
    const score = cleanScore(scores[id]);
    const winner = winningIds.includes(id);
    const mine = myTeam === id;
    let label = `${name} · ${score}`;
    if (winner) label += ` · ${TEXT.end.winner}`;
    if (mine) label += ` · ${TEXT.end.yours}`;
    return { team: id, name, color, score, winner, mine, label };
  }).sort((a, b) => b.score - a.score || a.team - b.team);

  if (winning.length === 0) {
    return { kind: "none", winners: [], headline: TEXT.end.title, rows };
  }
  if (winning.length === 1) {
    return { kind: "win", winners: winningIds, headline: TEXT.end.wins(winning[0]!.name), rows };
  }
  return {
    kind: "draw",
    winners: winningIds,
    headline: TEXT.end.draw(listNames(winning.map((t) => t.name))),
    rows,
  };
}
