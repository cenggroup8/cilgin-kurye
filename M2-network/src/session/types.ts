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

/** What M2 tells M1 about players. M2-2's input queue takes these later. */
export interface PlayerEvents {
  /** The phone chose a team in the lobby. */
  join(e: { playerKey: string; playerNo: number; name: string; team: number }): void;
  /** The link of a player was lost. */
  lost(e: { playerKey: string; playerNo: number }): void;
  /** A lost player came back with the same key. */
  returned(e: { playerKey: string; playerNo: number }): void;
}

export const MAX_PLAYERS = 8;
