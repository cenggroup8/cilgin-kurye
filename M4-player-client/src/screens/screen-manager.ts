// Decides which of the five screens is shown.
//
// The manager has no DOM and no socket. The network client (M4-3) tells it
// what happened; the screens and the scene (M4-5) listen to what it decides.
// Because it is plain logic, it runs in a test without a browser.
//
//   no welcome yet            -> join
//   welcome, no state yet     -> lobby
//   phase lobby               -> lobby
//   phase countdown           -> countdown
//   phase playing             -> game
//   phase paused              -> the screen we are on (no change)
//   phase ended               -> end

import type { JoinRefusal, Phase, ScreenName } from "./placeholder-types.ts";

export type ScreenListener = (screen: ScreenName, previous: ScreenName) => void;

/** The screen for a phase, or null when the phase keeps the current screen. */
export function screenForPhase(phase: Phase): ScreenName | null {
  switch (phase) {
    case "lobby":
      return "lobby";
    case "countdown":
      return "countdown";
    case "playing":
      return "game";
    case "ended":
      return "end";
    case "paused":
      return null;
  }
}

export class ScreenManager {
  private current: ScreenName = "join";
  private joined = false;
  private refusal: JoinRefusal | null = null;
  private listeners = new Set<ScreenListener>();

  get screen(): ScreenName {
    return this.current;
  }

  /** The scene (M4-5) draws only on the game screen. */
  get sceneWanted(): boolean {
    return this.current === "game";
  }

  /** The reason of the last refused hello, shown on the join screen. */
  get joinRefusal(): JoinRefusal | null {
    return this.refusal;
  }

  /** Calls `listener` on every screen change. Returns a function that stops it. */
  subscribe(listener: ScreenListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** M2 accepted the hello. Also true for a player who comes back after a reload. */
  onWelcome(): void {
    this.joined = true;
    this.refusal = null;
    // Until the first state arrives we do not know the phase; the lobby is the
    // safe place. A returning player jumps on at the first state.
    if (this.current === "join") this.show("lobby");
  }

  /** M2 refused the hello. The player stays on the join screen. */
  onRefused(reason: JoinRefusal): void {
    this.joined = false;
    this.refusal = reason;
    this.show("join");
  }

  /** A game state arrived. Before a welcome it is ignored. */
  onPhase(phase: Phase): void {
    if (!this.joined) return;
    const next = screenForPhase(phase);
    // A pause keeps the screen. Known limit: a player who reloads the page
    // during a pause stays on the lobby until the game resumes.
    if (next !== null) this.show(next);
  }

  /** The session is gone (for example the player left). Back to the join screen. */
  onSessionLost(): void {
    this.joined = false;
    this.show("join");
  }

  private show(next: ScreenName): void {
    if (next === this.current) return;
    const previous = this.current;
    this.current = next;
    for (const listener of [...this.listeners]) listener(next, previous);
  }
}
