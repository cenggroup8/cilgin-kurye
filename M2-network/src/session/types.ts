/** Session record of one link. The other M2 parts read these fields. */
export type Role = "player" | "admin";

export interface Session {
  /** Number of the link, given by the WebSocket server. */
  connId: number;
  role: Role;
  /** Players only: the random key that the phone browser keeps. */
  playerKey?: string;
  /** Players only: 0 to 7. */
  playerNo?: number;
  name?: string;
  /** Last order number seen from this link (M2-2 checks it). */
  lastSeq: number;
  /** Message counters for the limits in M2-2. */
  msgsIn: number;
  bytesIn: number;
  openedAt: number;
}

/**
 * What M2 tells M1 about players. M2-2's input queue takes these later.
 *
 * A join is only a request: M1 decides whether the team is free and answers with
 * `M2Server.answerJoin()` (see `JoinAnswer`).
 */
export interface PlayerEvents {
  /** The phone chose a team in the lobby. */
  join(e: { playerKey: string; playerNo: number; name: string; team: number }): void;
  /** The link of a player was lost. */
  lost(e: { playerKey: string; playerNo: number }): void;
  /** A lost player came back with the same key. */
  returned(e: { playerKey: string; playerNo: number }): void;
}

/**
 * M1's answer to a join, given back to M2-1 with `answerJoin()`.
 * Accepted: the phone gets `joined {player, team, color}`. M2-1 keeps the team, so a player
 * that comes back with the same key gets `joined` again right after its `welcome`.
 * Refused (for example the team is full or the game is not in the lobby): the phone gets
 * `error {reason: "bad_join", ref: "join"}`.
 */
export interface JoinAnswer {
  playerKey: string;
  ok: boolean;
  /** The accepted team (0–3). Needed when `ok` is true. */
  team?: number;
}

export const MAX_PLAYERS = 8;

/** Team colours of `contracts/README.md`, by team number. */
export const TEAM_COLORS = ["blue", "green", "purple", "yellow"] as const;
