import { describe, expect, it } from "vitest";
import { buildGameState, buildBoardState } from "../src/state/state-builder.js";
import { createInitialWorld, MATCH_DURATION_TICKS, TICK_RATE } from "../src/state/world.js";

describe("buildGameState", () => {
  it("produces correct time values", () => {
    const world = createInitialWorld();
    world.phase = "playing";
    world.tick = 100;
    world.gameTimeTicks = 900; // 30 seconds

    const gs = buildGameState(world);
    expect(gs.tick).toBe(100);
    expect(gs.phase).toBe("playing");
    expect(gs.gameTimeSeconds).toBe(30);
    expect(gs.remainingSeconds).toBe((MATCH_DURATION_TICKS - 900) / TICK_RATE);
  });

  it("copies player data with penalty in seconds", () => {
    const world = createInitialWorld();
    world.players[0]!.name = "Alice";
    world.players[0]!.connected = true;
    world.players[0]!.isBot = false;
    world.penaltyTicks[0] = 90; // 3 seconds

    const gs = buildGameState(world);
    expect(gs.players[0]!.name).toBe("Alice");
    expect(gs.players[0]!.penaltySeconds).toBe(3);
  });

  it("deep copies obstacles (mutation safety)", () => {
    const world = createInitialWorld();
    world.obstacles.push({
      id: 1, type: "road_work", segment: 5, lane: 0, pos: 0.5,
      endTick: 1000, source: "admin",
    });

    const gs = buildGameState(world);
    expect(gs.obstacles).toHaveLength(1);
    expect(gs.obstacles[0]!.id).toBe(1);

    // Mutating the world should not affect the snapshot
    world.obstacles[0]!.pos = 0.9;
    expect(gs.obstacles[0]!.pos).toBe(0.5);
  });

  it("includes quake when active", () => {
    const world = createInitialWorld();
    world.quake = { active: true, centerX: 10, centerY: 20, radius: 50, magnitude: 5, endTick: 500 };

    const gs = buildGameState(world);
    expect(gs.quake).not.toBeNull();
    expect(gs.quake!.magnitude).toBe(5);
  });

  it("quake is null when no earthquake", () => {
    const world = createInitialWorld();
    const gs = buildGameState(world);
    expect(gs.quake).toBeNull();
  });
});

describe("buildBoardState", () => {
  it("maps phase and time left", () => {
    const world = createInitialWorld();
    world.phase = "playing";
    world.gameTimeTicks = 600; // 20s played

    const bs = buildBoardState(world);
    expect(bs.ph).toBe("playing");
    expect(bs.tl).toBeCloseTo((MATCH_DURATION_TICKS - 600) / TICK_RATE);
  });

  it("includes only connected or bot players", () => {
    const world = createInitialWorld();
    world.players[0]!.connected = true;
    world.players[0]!.isBot = false;
    world.players[1]!.connected = false;
    world.players[1]!.isBot = false;
    world.players[2]!.isBot = true;

    const bs = buildBoardState(world);
    // player 0 (connected human) + player 2..7 (bots by default) = 7
    // player 1 is disconnected non-bot
    const connectedOrBot = world.players.filter(p => p.connected || p.isBot).length;
    expect(bs.p).toHaveLength(connectedOrBot);
  });

  it("maps obstacles to board format", () => {
    const world = createInitialWorld();
    world.obstacles.push({
      id: 1, type: "puddle", segment: 3, lane: 2, pos: 0.7,
      endTick: 500, source: "random",
    });

    const bs = buildBoardState(world);
    expect(bs.ob).toHaveLength(1);
    expect(bs.ob[0]).toEqual({ type: "puddle", segment: 3, lane: 2, pos: 0.7 });
  });
});
