// TEMPORARY PLACEHOLDER TYPES for M4-1 (screens and HUD).
//
// The phone messages and the game state fields are not in `contracts/` yet
// (they come with M2-2, #35). Until then every screen file reads its data
// types from this one file, so there is a single place to replace.
//
// Where a shape comes from:
//   - Phase names follow the M1 module document (lobby, countdown, playing,
//     paused, ended).
//   - Hello / join / welcome / error follow the draft in the M2-1 pull
//     request (#58). That draft is not final either.
//   - Everything else (team counts, connection state) is a guess that the
//     fake server of M4-2 and the network client of M4-3 must confirm.
//
// When `contracts/messages.md` and the M4-3 types exist: delete this file and
// import from there. Do not add new fields here without telling M4-2 and M4-3.

/** The five game phases of M1. */
export type Phase = "lobby" | "countdown" | "playing" | "paused" | "ended";

/** The five screens of the page. */
export type ScreenName = "join" | "lobby" | "countdown" | "game" | "end";

/** Team number as in `contracts/README.md`: 0 blue, 1 green, 2 purple, 3 yellow. */
export type TeamId = 0 | 1 | 2 | 3;

export const MAX_PLAYERS_PER_TEAM = 2;

/** Why M2 refused a hello (draft of M2-1). */
export type JoinRefusal = "bad_code" | "full" | "bad_hello";

/** Link state that M4-3 will give to M4-1. */
export type ConnectionState = "connected" | "reconnecting";

/** Phone to server: must be the first message (draft of M2-1). */
export interface HelloMessage {
  t: "hello";
  key: string;
  name: string;
  code: string;
}

/** Phone to server: the team the player picked in the lobby (draft of M2-1). */
export interface JoinMessage {
  t: "join";
  team: TeamId;
}

/** Server to phone, accepted hello (draft of M2-1). */
export interface WelcomeMessage {
  t: "welcome";
  player: number;
  returning: boolean;
}

/** Server to phone, refused hello (draft of M2-1). */
export interface ErrorMessage {
  t: "error";
  reason: JoinRefusal;
}

/**
 * How many players are in each team, index = team number. GUESS: the lobby
 * needs this to show a full team, but the game state fields are not decided.
 * M1 and M2 must say where this comes from.
 */
export type TeamCounts = readonly number[];

/** Who the player is. M4-3 will fill this from the welcome message. */
export interface PlayerInfo {
  player: number;
  /** The chosen team, or null while the player has not picked one. */
  team: TeamId | null;
}

// ---- Added for the countdown and end screens (M4-1, step 4) ----

/** The countdown before the game lasts 3 seconds (v2.1 section 8.5). Not a guess. */
export const COUNTDOWN_SECONDS = 3;

/**
 * TAHMİN: M1 runs 30 ticks per second (v2.1 section 5.5, and `TICKS_PER_SECOND`
 * in PR #59). The phone needs it to turn ticks into seconds. The game state may
 * give seconds instead; then this constant goes away.
 */
export const TICKS_PER_SECOND = 30;

/**
 * TAHMİN: ticks left in the countdown, like `countdownTicksLeft` of `Match` in
 * PR #59 (M1-2). Whether and how the game state carries it is not decided
 * (#35, #29). `undefined` means "not known yet".
 */
export type CountdownTicksLeft = number | undefined;

/**
 * TAHMİN: the points of each team, index = team number. v2.1 section 5.3 says the
 * state has "scores"; the exact shape is not written. Missing or wrong values are read as 0.
 */
export type TeamScores = readonly number[];

/**
 * TAHMİN: the winning teams at the end, one team for a win and more than one for a
 * draw (like `winners` of `Match` in PR #59). M1 decides the winner, so the page
 * does not work it out from the scores. The state may not carry this field; then
 * M1-1 or M2-2 must add it.
 */
export type Winners = readonly number[];

// ---- Added for the HUD (M4-1, HUD step 1) ----

/**
 * TAHMİN: everything the HUD needs from one game state, for the player of this
 * phone. The game state fields are not decided (#35); `hud/hud-source.ts` makes
 * this frame from the shape of PR #78, and it is the only file to change when
 * the real messages exist.
 */
export interface HudFrame {
  /** Seconds left in the game. */
  remainingSeconds: number;
  /** Points of each team, index = team number. */
  scores: TeamScores;
  /** The team of this phone, or null while it is not known. */
  myTeam: TeamId | null;
  /** True while this player carries a package (the compass then points to the delivery point). */
  hasPackage: boolean;
  /** Seconds this player still waits after a fall. 0 = not waiting. */
  penaltySeconds: number;
  /** Ticks (TICKS_PER_SECOND per second) until "Find me" can be used again. 0 = ready. */
  findMeCooldownTicks: number;
}
