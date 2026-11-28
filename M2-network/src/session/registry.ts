import type { GameCode } from "../http/gameCode.js";
import { MAX_PLAYERS, type PlayerEvents, type Session } from "./types.js";

export type HelloResult =
  | { ok: true; playerNo: number; returning: boolean; replacedConnId?: number }
  | { ok: false; reason: "bad_code" | "full" | "bad_hello" };

/** A player place. It stays with the player key while the link is down. */
interface Slot {
  playerKey: string;
  playerNo: number;
  name: string;
  connId: number | null;
}

/**
 * Sessions and access (M2-1). Pure logic without sockets, so it is tested alone.
 *
 * - One session for each phone link and one admin session.
 * - A new admin link takes the place of the old one.
 * - The player key keeps the same player number after a reload or a lost link.
 * - At most 8 players. A new key gets "full" when all places are taken.
 */
export class SessionRegistry {
  private sessions = new Map<number, Session>();
  private slots = new Map<string, Slot>();
  private adminConnId: number | null = null;

  constructor(
    private readonly gameCode: GameCode,
    private readonly events: PlayerEvents,
    private readonly now: () => number = Date.now,
  ) {}

  /** A new link opened. Players are not admitted until their hello. */
  open(connId: number, role: "player" | "admin"): { replacedAdmin?: number } {
    this.sessions.set(connId, {
      connId,
      role,
      lastSeq: -1,
      msgsIn: 0,
      bytesIn: 0,
      openedAt: this.now(),
    });
    if (role !== "admin") return {};
    const old = this.adminConnId;
    this.adminConnId = connId;
    if (old === null) return {};
    this.sessions.delete(old);
    return { replacedAdmin: old };
  }

  /** Hello from a phone: player key, name and game code. */
  hello(connId: number, msg: { playerKey?: unknown; name?: unknown; code?: unknown }): HelloResult {
    const session = this.sessions.get(connId);
    const key = msg.playerKey;
    if (!session || session.role !== "player" || session.playerKey !== undefined) {
      return { ok: false, reason: "bad_hello" };
    }
    if (typeof key !== "string" || key.length === 0 || key.length > 64) {
      return { ok: false, reason: "bad_hello" };
    }
    const name = typeof msg.name === "string" ? msg.name.slice(0, 24) : "";

    const known = this.slots.get(key);
    // A known key was already let in, so it may come back without the new code.
    if (!known && !this.gameCode.matches(msg.code)) return { ok: false, reason: "bad_code" };

    if (known) {
      const replacedConnId = known.connId ?? undefined;
      const returning = known.connId === null;
      if (replacedConnId !== undefined) this.sessions.delete(replacedConnId);
      known.connId = connId;
      if (name) known.name = name;
      this.bind(session, known);
      if (returning) this.events.returned({ playerKey: key, playerNo: known.playerNo });
      return { ok: true, playerNo: known.playerNo, returning, replacedConnId };
    }

    const playerNo = this.freeNumber();
    if (playerNo === null) return { ok: false, reason: "full" };
    const slot: Slot = { playerKey: key, playerNo, name, connId };
    this.slots.set(key, slot);
    this.bind(session, slot);
    return { ok: true, playerNo, returning: false };
  }

  /** Join with a team. Checking the team is M1's work, M2 only passes it on. */
  join(connId: number, team: unknown): boolean {
    const s = this.sessions.get(connId);
    if (!s?.playerKey || s.playerNo === undefined) return false;
    if (typeof team !== "number" || !Number.isInteger(team)) return false;
    this.events.join({ playerKey: s.playerKey, playerNo: s.playerNo, name: s.name ?? "", team });
    return true;
  }

  /** A link closed. */
  close(connId: number): void {
    const s = this.sessions.get(connId);
    if (!s) return;
    this.sessions.delete(connId);
    if (s.role === "admin") {
      if (this.adminConnId === connId) this.adminConnId = null;
      return;
    }
    const slot = s.playerKey ? this.slots.get(s.playerKey) : undefined;
    if (slot && slot.connId === connId) {
      slot.connId = null;
      this.events.lost({ playerKey: slot.playerKey, playerNo: slot.playerNo });
    }
  }

  /** Frees a player place for good. M1 decides when (for example on reset). */
  release(playerKey: string): void {
    this.slots.delete(playerKey);
  }

  get(connId: number): Session | undefined {
    return this.sessions.get(connId);
  }

  get adminConn(): number | null {
    return this.adminConnId;
  }

  players(): Array<{ playerKey: string; playerNo: number; name: string; connected: boolean }> {
    return [...this.slots.values()]
      .map((s) => ({ playerKey: s.playerKey, playerNo: s.playerNo, name: s.name, connected: s.connId !== null }))
      .sort((a, b) => a.playerNo - b.playerNo);
  }

  private bind(session: Session, slot: Slot): void {
    session.playerKey = slot.playerKey;
    session.playerNo = slot.playerNo;
    session.name = slot.name;
  }

  private freeNumber(): number | null {
    const used = new Set([...this.slots.values()].map((s) => s.playerNo));
    for (let n = 0; n < MAX_PLAYERS; n++) if (!used.has(n)) return n;
    return null;
  }
}
