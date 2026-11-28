// Messages of the phone link and the data the network client gives to the other
// M4 parts (M4-3, plan #26 sections 3.1 and 3.2).
//
// The messages are the ones of `contracts/messages.md` (#90). Only this folder talks to
// the server; the other parts get the data below and never touch the socket.

// ---- phone → server ----

export interface HelloMessage { t: "hello"; key: string; name: string; code: string }
export interface JoinMessage { t: "join"; team: number }
export interface ControlMessage { t: "control"; seq: number; throttle: number; brake: number; steer: number }
export interface FindMeMessage { t: "find_me" }
export interface PongMessage { t: "pong"; id: number; ct: number; fps: number; last: number }

export type PhoneMessage = HelloMessage | JoinMessage | ControlMessage | FindMeMessage | PongMessage;

// ---- server → phone ----

export interface WelcomeMessage { t: "welcome"; player: number; returning: boolean }
export interface JoinedMessage { t: "joined"; player: number; team: number; color: string }
export interface ErrorMessage { t: "error"; reason: string; ref?: string }
/** `s` is the frozen game state of M1 (#78). Its fields are not checked here. */
export interface StateMessage { t: "state"; seq: number; s: Record<string, unknown> }
export interface PingMessage { t: "ping"; id: number; st: number }
export interface NetMessage { t: "net"; fps_limit: number }

export type ServerMessage = WelcomeMessage | JoinedMessage | ErrorMessage | StateMessage | PingMessage | NetMessage;

/** Reasons of a refused hello; the link is then closed with 4003 (contract, M2-1). */
export type Refusal = "bad_code" | "full" | "bad_hello";

/** WebSocket close codes of M2-1 (`wsServer.ts`). */
export const CLOSE = { adminReplaced: 4001, playerReplaced: 4002, rejected: 4003 } as const;

// ---- data for the other M4 parts (plan #26 section 3.2) ----

/** One control record of M4-2 (`Controls`). M4-2 gives the number; this part only sends it. */
export interface Control { seq: number; throttle: number; brake: number; steer: number }

/**
 * Link state for M4-1:
 * - `idle`: no join yet
 * - `connecting`: the first link is opening
 * - `connected`: the hello was accepted
 * - `reconnecting`: the link was lost; the client tries again with the same key
 * - `refused`: the hello was refused (wrong code, game full); the player must join again
 * - `replaced`: the same player was opened on another page; this page stops
 */
export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "refused" | "replaced";

/** Who this phone is, for M4-1 and M4-5. `team` and `color` are known after `joined`. */
export interface PlayerInfo { player: number; returning: boolean; team: number | null; color: string | null }

/** A decoded game state for M4-1, M4-4 and M4-5, as it arrives. */
export interface GameStateUpdate {
  /** Tick number of the state. */
  seq: number;
  /** The game state of M1. */
  state: Record<string, unknown>;
  /** Phone time (ms) when it arrived, for drawing other players a little in the past. */
  receivedAt: number;
}

export const TEAM_COLORS = ["blue", "green", "purple", "yellow"] as const;
