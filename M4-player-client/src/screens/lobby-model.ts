// What the lobby shows for each team. No DOM.

import { MAX_PLAYERS_PER_TEAM, type TeamCounts, type TeamId } from "./placeholder-types.ts";
import { TEXT } from "./texts.ts";

/**
 * Team names and the CSS colour of each team button on the phone.
 * The order is the team number of `contracts/README.md`. The hex values are
 * our choice for the phone screen; the contract gives only the colour names.
 */
export const TEAMS: ReadonlyArray<{ id: TeamId; name: string; color: string }> = [
  { id: 0, name: "Blue", color: "#2f6fdb" },
  { id: 1, name: "Green", color: "#2e9e55" },
  { id: 2, name: "Purple", color: "#8a4fd0" },
  { id: 3, name: "Yellow", color: "#e0b020" },
];

export interface TeamSlot {
  team: TeamId;
  name: string;
  color: string;
  count: number;
  /** The team has no place left. */
  full: boolean;
  /** This is the team the player already chose. */
  mine: boolean;
  /** The player may press this team. */
  selectable: boolean;
  /** For example "Blue · 1/2" or "Blue · 2/2 · Full". */
  label: string;
}

function cleanCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** One slot for each of the four teams. A missing or wrong count is read as 0. */
export function teamSlots(counts: TeamCounts, myTeam: TeamId | null): TeamSlot[] {
  return TEAMS.map(({ id, name, color }) => {
    const count = cleanCount(counts[id]);
    const mine = myTeam === id;
    const full = count >= MAX_PLAYERS_PER_TEAM;
    let label = `${name} · ${Math.min(count, MAX_PLAYERS_PER_TEAM)}/${MAX_PLAYERS_PER_TEAM}`;
    if (mine) label += ` · ${TEXT.lobby.yours}`;
    else if (full) label += ` · ${TEXT.lobby.full}`;
    return { team: id, name, color, count, full, mine, selectable: !mine && !full, label };
  });
}
