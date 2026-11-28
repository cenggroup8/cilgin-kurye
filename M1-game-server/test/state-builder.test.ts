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
    world.quake = { active: true, centerX: 10, centerZ: 20, radius: 50, magnitude: 5, startTick: 0, endTick: 500 };

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
    expect(bs.phase).toBe("playing");
    expect(bs.timeLeft_s).toBeCloseTo((MATCH_DURATION_TICKS - 600) / TICK_RATE);
  });

  it("includes only connected or bot players", () => {
    const world = createInitialWorld();
    world.players[0]!.connected = true;
    world.players[0]!.isBot = false;
    world.players[1]!.connected = false;
    world.players[1]!.isBot = false;
    world.players[2]!.isBot = true;

    const bs = buildBoardState(world);
    const connectedOrBot = world.players.filter(p => p.connected || p.isBot).length;
    expect(bs.players).toHaveLength(connectedOrBot);
  });

  it("maps obstacles to board format", () => {
    const world = createInitialWorld();
    world.obstacles.push({
      id: 1, type: "puddle", segment: 3, lane: 2, pos: 0.7,
      endTick: 500, source: "random",
    });

    const bs = buildBoardState(world);
    expect(bs.obstacles).toHaveLength(1);
    expect(bs.obstacles[0]).toEqual({ type: "puddle", segment: 3, lane: 2 });
  });

  it("delivery points use correct player index after filter", () => {
    const world = createInitialWorld();
    // Player 0 has no delivery, player 1 has one
    world.deliveries[0]!.targetPoint = -1;
    world.deliveries[1]!.targetPoint = 5;
    world.deliveries[1]!.compassTarget = { x: 100, z: 200 };
    world.players[1]!.team = 2;

    const bs = buildBoardState(world);
    expect(bs.deliveries).toHaveLength(1);
    expect(bs.deliveries[0]!.player).toBe(1); // player index, not filtered index
    expect(bs.deliveries[0]!.x).toBe(100);
    expect(bs.deliveries[0]!.z).toBe(200);
  });

  it("board players include heading, speed, and bot fields", () => {
    const world = createInitialWorld();
    world.players[0]!.connected = true;
    world.players[0]!.isBot = false;
    world.poses[0]!.heading = 90;
    world.poses[0]!.speed = 5.5;

    const bs = buildBoardState(world);
    const p0 = bs.players.find(p => p.no === 0)!;
    expect(p0.heading).toBe(90);
    expect(p0.speed).toBe(5.5);
    expect(p0.bot).toBe(false);
    expect(p0.inGame).toBe(true);
  });

  it("quake includes magnitude and elapsed ms", () => {
    const world = createInitialWorld();
    world.tick = 100;
    world.quake = { active: true, centerX: 10, centerZ: 20, radius: 50, magnitude: 7, startTick: 70, endTick: 500 };

    const bs = buildBoardState(world);
    expect(bs.quake).not.toBeNull();
    expect(bs.quake!.mag).toBe(7);
    expect(bs.quake!.ms).toBeCloseTo((100 - 70) * (1000 / TICK_RATE));
  });
});
