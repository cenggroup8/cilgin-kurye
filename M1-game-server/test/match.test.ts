import { describe, expect, it } from "vitest";
import { Match, type MatchEvent } from "../src/match/match.js";

// Short times so the tests stay readable: 3-tick countdown, 20-tick game, 5-tick wait.
const SHORT = { countdownTicks: 3, gameTicks: 20, lostWaitTicks: 5 };
const NO_SCORES = [0, 0, 0, 0];

function run(m: Match, ticks: number, scores: number[] = NO_SCORES): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...m.tick(scores));
  return out;
}

function started(bots = 0): Match {
  const m = new Match(SHORT);
  m.join("human-a", "Ayşe", 0);
  m.start(bots);
  return m;
}

describe("lobby", () => {
  it("at most 2 players in a team and 8 in total", () => {
    const m = new Match(SHORT);
    expect(m.join("a", "A", 0)).toEqual({ ok: true });
    expect(m.join("b", "B", 0)).toEqual({ ok: true });
    expect(m.join("c", "C", 0)).toEqual({ ok: false, error: "team_full" });
    for (let i = 0; i < 6; i++) expect(m.join(`p${i}`, "P", 1 + Math.floor(i / 2))).toEqual({ ok: true });
    expect(m.roster).toHaveLength(8);
    expect(m.join("ninth", "N", 3)).toEqual({ ok: false, error: "team_full" });
    expect(m.join("x", "X", 4)).toEqual({ ok: false, error: "bad_team" });
  });

  it("a player can change team while there is room", () => {
    const m = new Match(SHORT);
    m.join("a", "A", 0);
    expect(m.join("a", "A", 2)).toEqual({ ok: true });
    expect(m.roster[0]).toMatchObject({ playerNo: 0, team: 2 });
  });

  it("start fills empty places with the number of bots the admin chose", () => {
    const m = new Match(SHORT);
    m.join("a", "A", 0);
    m.start(3);
    expect(m.roster.map((p) => [p.playerNo, p.team, p.human])).toEqual([
      [0, 0, true],
      [1, 1, false],
      [2, 2, false],
      [3, 3, false],
    ]);
  });

  it("bots never go over 2 per team or 8 in total", () => {
    const m = new Match(SHORT);
    m.join("a", "A", 0);
    m.start(8);
    expect(m.roster).toHaveLength(8);
    for (let t = 0; t < 4; t++) expect(m.roster.filter((p) => p.team === t)).toHaveLength(2);
  });

  it("a game starts with one human player", () => {
    const m = started(0);
    expect(m.phase).toBe("countdown");
    run(m, 3);
    expect(m.phase).toBe("playing");
  });

  it("no join after the start", () => {
    const m = started();
    expect(m.join("late", "L", 1)).toEqual({ ok: false, error: "not_in_lobby" });
  });
});

describe("phases", () => {
  it("lobby → countdown → playing → ended when the time runs out", () => {
    const m = started();
    const events = run(m, 3 + 20, [0, 4, 0, 0]);
    expect(events.filter((e) => e.type === "phase")).toEqual([
      { type: "phase", from: "lobby", to: "countdown" },
      { type: "phase", from: "countdown", to: "playing" },
      { type: "phase", from: "playing", to: "ended" },
    ]);
    expect(m.phase).toBe("ended");
    expect(m.timeLeftTicks).toBe(0);
  });

  it("nobody moves in the countdown", () => {
    const m = started();
    expect(m.canMove).toBe(false);
    run(m, 2);
    expect(m.canMove).toBe(false);
    run(m, 1);
    expect(m.canMove).toBe(true);
  });

  it("the team with the most points wins", () => {
    const m = started(3);
    run(m, 3 + 20, [5, 9, 2, 0]);
    expect(m.winners).toEqual([1]);
  });

  it("equal points end in a draw between those teams only", () => {
    const m = started(3);
    const events = run(m, 3 + 20, [7, 2, 7, 1]);
    expect(m.winners).toEqual([0, 2]);
    expect(events.at(-1)).toEqual({ type: "game_over", winners: [0, 2], draw: true });
  });

  it("the admin can end the game early", () => {
    const m = started(1);
    run(m, 3 + 5);
    expect(m.end([0, 3, 0, 0])).toEqual({ ok: true });
    expect(m.phase).toBe("ended");
    expect(m.winners).toEqual([1]);
    expect(m.end(NO_SCORES)).toEqual({ ok: false, error: "not_running" });
  });

  it("reset goes back to the lobby; bots leave, humans stay", () => {
    const m = started(2);
    run(m, 3 + 20);
    m.reset();
    expect(m.phase).toBe("lobby");
    expect(m.roster.map((p) => p.playerKey)).toEqual(["human-a"]);
    expect(m.gameTimeTicks).toBe(0);
    expect(m.winners).toEqual([]);
  });
});

describe("pause", () => {
  it("everything stops during a pause: game time and the wait of a lost player", () => {
    const m = started();
    run(m, 3 + 4);
    m.lost("human-a");
    run(m, 2);
    expect(m.pause()).toEqual({ ok: true });
    expect(m.clockRunning).toBe(false);
    run(m, 50);
    expect(m.gameTimeTicks).toBe(6);
    expect(m.roster[0]).toMatchObject({ lostTicks: 2, botControlled: false });
    m.resume();
    expect(m.phase).toBe("playing");
    expect(m.clockRunning).toBe(true);
    run(m, 1);
    expect(m.gameTimeTicks).toBe(7);
  });

  it("a pause in the countdown starts the countdown again on resume", () => {
    const m = started();
    run(m, 2);
    expect(m.countdownTicksLeft).toBe(1);
    m.pause();
    m.resume();
    expect(m.phase).toBe("countdown");
    expect(m.countdownTicksLeft).toBe(3);
    run(m, 2);
    expect(m.phase).toBe("countdown");
    run(m, 1);
    expect(m.phase).toBe("playing");
  });

  it("pause and resume only where they make sense", () => {
    const m = new Match(SHORT);
    expect(m.pause()).toEqual({ ok: false, error: "cannot_pause" });
    expect(m.resume()).toEqual({ ok: false, error: "not_paused" });
  });
});

describe("lost players", () => {
  it("back before 30 s: the player rides on, no bot took over", () => {
    const m = started();
    run(m, 3);
    m.lost("human-a");
    run(m, 4);
    expect(m.roster[0].botControlled).toBe(false);
    m.returned("human-a");
    const events = run(m, 1);
    expect(events).toContainEqual({ type: "player_back", playerNo: 0, fromBot: false });
    expect(m.roster[0]).toMatchObject({ connected: true, botControlled: false, lostTicks: null });
  });

  it("after 30 s a bot takes over; coming back later gives the motorcycle back", () => {
    const m = started();
    run(m, 3);
    m.lost("human-a");
    const events = run(m, 5);
    expect(events).toContainEqual({ type: "bot_took_over", playerNo: 0 });
    expect(m.roster[0].botControlled).toBe(true);
    m.returned("human-a");
    expect(run(m, 1)).toContainEqual({ type: "player_back", playerNo: 0, fromBot: true });
    expect(m.roster[0]).toMatchObject({ connected: true, botControlled: false, playerNo: 0, team: 0 });
  });

  it("an unknown key coming back changes nothing", () => {
    const m = started();
    m.returned("stranger");
    expect(m.roster).toHaveLength(1);
  });
});

describe("same inputs, same match", () => {
  it("two runs of the same script give the same state", () => {
    const script = (m: Match) => {
      m.join("a", "A", 0);
      m.join("b", "B", 1);
      m.start(4);
      run(m, 5);
      m.lost("b");
      m.pause();
      run(m, 10);
      m.resume();
      run(m, 20, [1, 2, 2, 0]);
      return JSON.stringify({ phase: m.phase, roster: m.roster, winners: m.winners, t: m.gameTimeTicks });
    };
    expect(script(new Match(SHORT))).toBe(script(new Match(SHORT)));
  });

  it("the default times are the ones in the document", () => {
    const m = new Match();
    expect(m.config).toEqual({ countdownTicks: 90, gameTicks: 9000, lostWaitTicks: 900 });
    expect(() => new Match({ gameTicks: 9001 })).toThrow();
  });
});
