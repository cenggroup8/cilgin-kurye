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
