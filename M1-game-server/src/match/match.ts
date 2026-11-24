/**
 * Match and lobby (M1-2).
 *
 * Owns the game phase and the roster ("Kadro" in the M1 plan, section 3.2):
 *   lobby → countdown → playing → ended, and paused from countdown or playing.
 *
 * Time comes only from tick() calls, never from a clock, so the same inputs
 * always give the same match. The game loop (M1-1) calls the input methods in
 * step 2 of a tick and tick() in step 3.
 */

export const TICKS_PER_SECOND = 30;
export const TEAMS = 4;
export const MAX_PER_TEAM = 2;
export const MAX_PLAYERS = TEAMS * MAX_PER_TEAM;

export type Phase = "lobby" | "countdown" | "playing" | "paused" | "ended";

export interface MatchConfig {
  /** Countdown before the game, 3 s in the document. */
  countdownTicks: number;
  /** Length of a game, at most 5 minutes. */
  gameTicks: number;
  /** How long the place of a lost player is kept before a bot takes over, 30 s. */
  lostWaitTicks: number;
}

export const DEFAULT_CONFIG: MatchConfig = {
  countdownTicks: 3 * TICKS_PER_SECOND,
  gameTicks: 5 * 60 * TICKS_PER_SECOND,
  lostWaitTicks: 30 * TICKS_PER_SECOND,
};

export interface RosterEntry {
  /** 0 to 7. */
  playerNo: number;
  /** Team 0 to 3. */
  team: number;
  /** The player key of a human, null for a bot that filled an empty place. */
  playerKey: string | null;
  name: string;
  human: boolean;
  /** Humans only: is the phone link up. */
  connected: boolean;
  /** True for bots, and for a human whose motorcycle a bot took over. */
  botControlled: boolean;
  /** Ticks the place of a lost human has waited (stops in a pause). */
  lostTicks: number | null;
}

export type Result = { ok: true } | { ok: false; error: string };

export type MatchEvent =
  | { type: "phase"; from: Phase; to: Phase }
  | { type: "bot_took_over"; playerNo: number }
  | { type: "player_back"; playerNo: number; fromBot: boolean }
  | { type: "game_over"; winners: number[]; draw: boolean };

const OK: Result = { ok: true };
const fail = (error: string): Result => ({ ok: false, error });

export class Match {
  readonly config: MatchConfig;
  private _phase: Phase = "lobby";
  private pausedFrom: "countdown" | "playing" | null = null;
  private countdownLeft = 0;
  private _gameTicks = 0;
  private _roster: RosterEntry[] = [];
  private _winners: number[] = [];
  private pending: MatchEvent[] = [];

  constructor(config: Partial<MatchConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (this.config.gameTicks > DEFAULT_CONFIG.gameTicks) {
      throw new Error("a game lasts at most 5 minutes");
    }
  }

  // ---- read by the other parts of M1 and by the state builder ----

  get phase(): Phase {
    return this._phase;
  }

  /** Motorcycles may move only while the game is played (not in the countdown). */
  get canMove(): boolean {
    return this._phase === "playing";
  }

  /**
   * False in a pause, in the lobby and at the end. Penalty times, obstacle
   * times and the NPC cars only go on while this is true.
   */
  get clockRunning(): boolean {
    return this._phase === "playing";
  }

  get gameTimeTicks(): number {
    return this._gameTicks;
  }

  get timeLeftTicks(): number {
    return this.config.gameTicks - this._gameTicks;
  }

  /** Ticks left in the countdown (0 outside it). */
  get countdownTicksLeft(): number {
    return this._phase === "countdown" || this.pausedFrom === "countdown" ? this.countdownLeft : 0;
  }

  get roster(): readonly Readonly<RosterEntry>[] {
    return this._roster;
  }

  /** Winning teams once the game has ended. More than one team means a draw. */
  get winners(): readonly number[] {
    return this._winners;
  }

  // ---- inputs from M2 (through the loop) ----

  /** A phone joined with a team, or changed its team, in the lobby. */
  join(playerKey: string, name: string, team: number): Result {
    if (this._phase !== "lobby") return fail("not_in_lobby");
    if (!Number.isInteger(team) || team < 0 || team >= TEAMS) return fail("bad_team");
    const me = this._roster.find((p) => p.playerKey === playerKey);
    if (me && me.team === team) return OK;
    if (this.teamSize(team) >= MAX_PER_TEAM) return fail("team_full");
    if (me) {
      me.team = team;
      me.name = name;
      return OK;
    }
    const playerNo = this.freeNumber();
    if (playerNo === null) return fail("game_full");
    this._roster.push({
      playerNo,
      team,
      playerKey,
      name,
      human: true,
      connected: true,
      botControlled: false,
      lostTicks: null,
    });
    this.sortRoster();
    return OK;
  }

  /** M2 lost the link of this player. */
  lost(playerKey: string): void {
    const p = this.human(playerKey);
    if (!p || !p.connected) return;
    p.connected = false;
    p.lostTicks = 0;
  }

  /** The player came back with the same player key. */
  returned(playerKey: string): void {
    const p = this.human(playerKey);
    if (!p || p.connected) return;
    const fromBot = p.botControlled;
    p.connected = true;
    p.botControlled = false;
    p.lostTicks = null;
    if (this._phase !== "lobby") this.pending.push({ type: "player_back", playerNo: p.playerNo, fromBot });
  }

  // ---- admin commands (through M1-5) ----

  /** Start: fill empty places with up to botCount bots, then count down. */
  start(botCount: number): Result {
    if (this._phase !== "lobby") return fail("not_in_lobby");
    if (!Number.isInteger(botCount) || botCount < 0 || botCount > MAX_PLAYERS) return fail("bad_bot_count");
    for (let i = 0; i < botCount; i++) {
      const playerNo = this.freeNumber();
      const team = this.smallestTeam();
      if (playerNo === null || team === null) break;
      this._roster.push({
        playerNo,
        team,
        playerKey: null,
        name: `Bot ${playerNo}`,
        human: false,
        connected: true,
        botControlled: true,
        lostTicks: null,
      });
    }
    if (this._roster.length === 0) return fail("no_players");
    this.sortRoster();
    this._gameTicks = 0;
    this.countdownLeft = this.config.countdownTicks;
    this.setPhase("countdown");
    return OK;
  }

  pause(): Result {
    if (this._phase !== "countdown" && this._phase !== "playing") return fail("cannot_pause");
    this.pausedFrom = this._phase;
    this.setPhase("paused");
    return OK;
  }

  /** Resume. A pause in the countdown starts the countdown again. */
  resume(): Result {
    if (this._phase !== "paused" || !this.pausedFrom) return fail("not_paused");
    const back = this.pausedFrom;
    this.pausedFrom = null;
    if (back === "countdown") this.countdownLeft = this.config.countdownTicks;
    this.setPhase(back);
    return OK;
  }

  /** The admin ends the game early. scores[team] comes from delivery (M1-3). */
  end(scores: readonly number[]): Result {
    if (this._phase === "lobby" || this._phase === "ended") return fail("not_running");
    this.finish(scores);
    return OK;
  }

  /** Back to the lobby. The bots leave, the humans keep their places and teams. */
  reset(): Result {
    this._roster = this._roster.filter((p) => p.human);
    for (const p of this._roster) {
      p.botControlled = false;
      p.lostTicks = p.connected ? null : 0;
    }
    this.pausedFrom = null;
    this.countdownLeft = 0;
    this._gameTicks = 0;
    this._winners = [];
    if (this._phase !== "lobby") this.setPhase("lobby");
    return OK;
  }

  // ---- step 3 of the tick ----

  /**
   * Moves the phase one tick forward. scores[team] is only read when the
   * time ends. Returns what happened in this tick.
   */
  tick(scores: readonly number[]): MatchEvent[] {
    if (this._phase === "countdown") {
      this.countLostPlayers();
      this.countdownLeft--;
      if (this.countdownLeft <= 0) this.setPhase("playing");
    } else if (this._phase === "playing") {
      this.countLostPlayers();
      this._gameTicks++;
      if (this._gameTicks >= this.config.gameTicks) this.finish(scores);
    }
    const out = this.pending;
    this.pending = [];
    return out;
  }

  // ---- inside ----

  private finish(scores: readonly number[]): void {
    const teams = [...new Set(this._roster.map((p) => p.team))].sort((a, b) => a - b);
    const best = Math.max(...teams.map((t) => scores[t] ?? 0));
    this._winners = teams.filter((t) => (scores[t] ?? 0) === best);
    this.pausedFrom = null;
    this.setPhase("ended");
    this.pending.push({ type: "game_over", winners: [...this._winners], draw: this._winners.length > 1 });
  }

  private countLostPlayers(): void {
    for (const p of this._roster) {
      if (!p.human || p.connected || p.botControlled || p.lostTicks === null) continue;
      p.lostTicks++;
      if (p.lostTicks >= this.config.lostWaitTicks) {
        p.botControlled = true;
        this.pending.push({ type: "bot_took_over", playerNo: p.playerNo });
      }
    }
  }

  private setPhase(to: Phase): void {
    const from = this._phase;
    this._phase = to;
    this.pending.push({ type: "phase", from, to });
  }

  private human(playerKey: string): RosterEntry | undefined {
    return this._roster.find((p) => p.human && p.playerKey === playerKey);
  }

  private teamSize(team: number): number {
    return this._roster.filter((p) => p.team === team).length;
  }

  /** The team with the fewest players that still has room (lowest number on a tie). */
  private smallestTeam(): number | null {
    let best: number | null = null;
    for (let t = 0; t < TEAMS; t++) {
      const n = this.teamSize(t);
      if (n >= MAX_PER_TEAM) continue;
      if (best === null || n < this.teamSize(best)) best = t;
    }
    return best;
  }

  private freeNumber(): number | null {
    const used = new Set(this._roster.map((p) => p.playerNo));
    for (let n = 0; n < MAX_PLAYERS; n++) if (!used.has(n)) return n;
    return null;
  }

  private sortRoster(): void {
    this._roster.sort((a, b) => a.playerNo - b.playerNo);
  }
}
