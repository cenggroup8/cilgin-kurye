/**
 * What M1 gets at the start of a tick (M2-2 → M1, plan #24 section 3.1 "Tick girdileri").
 *
 * Same shape as `TickInput` of M1-1 (`M1-game-server/src/loop/types.ts`, #78), so the
 * game loop can use `queue.take()` as its input provider. The two modules are separate
 * packages, so the shape is written here again; a change must be made in both places.
 *
 * Extra fields that M1-1 does not have yet are marked. M1 may ignore them.
 */

export interface ControlInput {
  /** Player number of the link (M2-1 `playerNo`), never the number in the message. */
  player: number;
  seq: number;
  throttle: number; // 0–1
  brake: number; // 0–1
  steer: number; // −1 – 1
}

export interface FindMeInput {
  player: number;
}

export interface JoinInput {
  playerKey: string;
  name: string;
  team: number;
  /** Extra: the player number M2-1 gave this key. Controls use this number. */
  playerNo: number;
}

export interface DisconnectInput {
  playerKey: string;
  /** Extra: player number of the key. */
  playerNo: number;
}

export interface ReconnectInput {
  playerKey: string;
  /** Extra: player number of the key. */
  playerNo: number;
}

/** `cmd` from the admin, checked by M2 (M1-5 `AdminCommand`). */
export interface AdminCommand {
  id: number;
  name: string;
  args?: Record<string, unknown>;
}

/** Earthquake event from the board (M1-1 `BoardEvent`). M2-4 gives it to the queue. */
export interface BoardEvent {
  source: "hand" | "motors";
  magnitude: number; // 0–10
  zone: number; // 0–8
  confidence: number; // 0–1
}

export interface TickInput {
  controls: ControlInput[];
  findMe: FindMeInput[];
  joins: JoinInput[];
  disconnects: DisconnectInput[];
  reconnects: ReconnectInput[];
  adminCommands: AdminCommand[];
  boardEvents: BoardEvent[];
}

export function emptyTickInput(): TickInput {
  return { controls: [], findMe: [], joins: [], disconnects: [], reconnects: [], adminCommands: [], boardEvents: [] };
}
