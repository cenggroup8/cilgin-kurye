// Board state from the world of M1 (metres, degrees) to the `S` lists (board_protocol.md section 4).

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { BoardLink } from "../src/board/boardLink.js";
import { encode } from "../src/board/codec.js";
import { type WorldBoardState, WORLD_SIZE_M, toBoardState } from "../src/board/worldState.js";
import { BoardEmu } from "./fakes/boardEmu.js";

const contract = (name: string) => JSON.parse(readFileSync(new URL(`../../contracts/${name}`, import.meta.url), "utf8"));
const STATE_VECTOR = (contract("board_protocol_vectors.json").vectors as { name: string; json: any; msgpack_hex: string }[])
  .find((v) => v.name === "state")!;

/** The world that the state vector shows: player 2 (team 1, bot, carries a package) at x 212.4 m, z 98.1 m … */
const WORLD: WorldBoardState = {
  phase: "playing",
  timeLeft_s: 239,
  players: [
    { no: 2, team: 1, tone: 0, x: 212.4, z: 98.1, heading: 88, speed: 11.2, inGame: true, fallen: false, carrying: true, bot: true, findMe: false },
    { no: 5, team: 3, tone: 1, x: 410, z: 300.2, heading: 180, speed: 7.9, inGame: true, fallen: false, carrying: false, bot: false, findMe: true },
  ],
  deliveries: [{ player: 2, x: 350, z: 152, delivered: false }],
  obstacles: [
    { segment: 12, type: "road_work", lane: 0 },
    { segment: 41, type: "accident", lane: 1 },
    { segment: 20, type: "heavy_traffic", lane: 0 },
  ],
  quake: { x: 260, z: 240, mag: 7, ms: 840 },
};

const round = (x: unknown): unknown =>
  JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "number" ? Number(v.toPrecision(7)) : v)));

describe("world state to the S lists", () => {
  it("uses the size of the city plan", () => {
    expect(WORLD_SIZE_M).toBe(contract("city_plan.json").world.size_m);
  });

  it("gives the d of the state vector, to the byte", () => {
    const d = toBoardState(WORLD);
    expect(round(d)).toEqual(round(STATE_VECTOR.json.d));
    const msg = { ...STATE_VECTOR.json, d };
    expect(Buffer.from(encode(msg)).toString("hex")).toBe(STATE_VECTOR.msgpack_hex);
  });

  it("no earthquake is an empty list; every flag has its own bit", () => {
    const d = toBoardState({
      ...WORLD,
      quake: null,
      players: [{ ...WORLD.players[0]!, inGame: true, fallen: true, carrying: true, bot: true, findMe: true }],
    });
    expect(d.eq).toEqual([]);
    expect((d.p as number[][])[0]![3]).toBe(31);
    expect(round(toBoardState({ ...WORLD, players: [{ ...WORLD.players[0]!, inGame: false, carrying: false, bot: false }] }).p)).toEqual([
      [2, 1, 0, 0, 0.4248, 0.1962, 88, 11.2],
    ]);
  });

  it("keeps places on the board and the heading in 0–360", () => {
    const d = toBoardState({
      ...WORLD,
      players: [
        { ...WORLD.players[0]!, x: -3, z: 512, heading: -90 },
        { ...WORLD.players[1]!, heading: 360 + 45 },
      ],
      timeLeft_s: -0.4,
    });
    const p = d.p as number[][];
    expect([p[0]![4], p[0]![5], p[0]![6]]).toEqual([0, 1, 270]);
    expect(p[1]![6]).toBe(45);
    expect(d.tl).toBe(0);
  });

  it("every phase has its number", () => {
    const names = ["lobby", "countdown", "playing", "paused", "ended"] as const;
    expect(names.map((phase) => toBoardState({ ...WORLD, phase }).ph)).toEqual([0, 1, 2, 3, 4]);
  });

  it("throws on an unknown obstacle type or phase", () => {
    expect(() => toBoardState({ ...WORLD, obstacles: [{ segment: 1, type: "lava" as never, lane: 0 }] })).toThrow();
    expect(() => toBoardState({ ...WORLD, phase: "over" as never })).toThrow();
  });
});

describe("BoardLink.setWorldState", () => {
  const open: { close(): Promise<void> }[] = [];
  afterEach(async () => {
    for (const x of open.splice(0)) await x.close();
  });

  it("the board gets the lists; a bad state is refused and the old one stays", async () => {
    const link = new BoardLink({ port: 0, host: "127.0.0.1", resendMs: 300 });
    const port = await link.start();
    open.push(link);
    expect(link.setWorldState(WORLD)).toBe(true);
    expect(link.setWorldState({ ...WORLD, timeLeft_s: 1, obstacles: [{ segment: 1, type: "lava" as never, lane: 0 }] })).toBe(false);
    const emu = new BoardEmu({ host: "127.0.0.1", port });
    open.push(emu);
    await emu.start();
    const end = Date.now() + 5000;
    while (emu.states.length < 3 && Date.now() < end) await new Promise((ok) => setTimeout(ok, 20));
    expect(emu.states.length).toBeGreaterThanOrEqual(3);
    expect(round(emu.states.at(-1)!.d)).toEqual(round(STATE_VECTOR.json.d));
  });
});
