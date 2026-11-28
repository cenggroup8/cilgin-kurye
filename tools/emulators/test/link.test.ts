// The two emulators against each other on real sockets of this computer:
// the board emulator talks to the server emulator, which runs the M2-4 board link.

import { afterEach, describe, expect, it } from "vitest";
import { BoardEmulator } from "../src/board/boardEmulator.js";
import { ServerEmulator } from "../src/server/serverEmulator.js";

const open: { close(): Promise<void> }[] = [];

async function pair(boardOpts = {}) {
  const server = new ServerEmulator({ port: 0, host: "127.0.0.1", seed: 3, scenario: { lobbyS: 0.1, countdownS: 0.1 } });
  const port = await server.start();
  const board = new BoardEmulator({ host: "127.0.0.1", port, ...boardOpts });
  open.push(board, server);
  await board.start();
  await waitFor(() => board.connected && server.metrics().connected, 4000);
  return { server, board, port };
}

async function waitFor(ok: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

describe("board emulator ↔ server emulator", () => {
  it("connects, gets the config and the board states", async () => {
    const { server, board } = await pair();
    await waitFor(() => board.stats.statesReceived > 10, 2000);
    expect(board.config?.plan).toBe(server.plan.version);
    expect(board.latestState?.d).toHaveProperty("p");
    expect(board.stats.badMessages).toBe(0);
  });

  it("sends delay replies, sensor samples and the status report", async () => {
    const { server } = await pair();
    await waitFor(() => server.statusMessages >= 1 && server.metrics().delayMs !== null && server.sensorMessages > 5, 3000);
    expect(server.seismic.length).toBeGreaterThan(50);
    expect(server.lastStatus).toMatchObject({ fps: 60, err: [] });
    expect(server.metrics().badMessages).toBe(0);
  });

  it("a hand hit gives one earthquake event with zone and strength, and starts the shock wave", async () => {
    const { server, board } = await pair();
    expect(board.hit(4, 6)).toBe(1);
    await waitFor(() => server.quakes.length === 1 && board.stats.quakesAnswered === 1, 2000);
    expect(server.quakes[0]).toMatchObject({ src: "hit", zone: 4, mag: 6 });
    expect((server.scenario.boardState().eq as number[])[0]).toBe(1);
    await sleep(1500); // no second event, even after the resend time
    expect(server.quakes).toHaveLength(1);
  });

  it("vibrate: the motors run with a soft start and give one motor event", async () => {
    const { server, board } = await pair();
    expect(server.vibrate(0b0101, 0.8, 600, 100)).toBe(true); // motors at zone 0 and zone 6
    await waitFor(() => board.stats.vibrates === 1, 1000);
    const early = board.motorPower();
    expect(early[0]).toBeGreaterThan(0);
    expect(early[1]).toBe(0);
    await waitFor(() => server.quakes.length === 1, 1500);
    expect(server.quakes[0]).toMatchObject({ src: "motor", zone: 3 });
    await sleep(800);
    expect(board.motorPower()).toEqual([0, 0, 0, 0]);
    expect(server.quakes).toHaveLength(1);
  });

  it("stays connected with heavy loss on the link", async () => {
    const { server, board } = await pair();
    server.setNet("down", { lossPct: 50 });
    server.setNet("up", { lossPct: 50 });
    const before = board.stats.statesReceived;
    await sleep(2500);
    expect(board.connected).toBe(true);
    expect(server.metrics().connected).toBe(true);
    expect(board.stats.statesReceived - before).toBeGreaterThan(20);
    expect(board.hit(1, 5)).toBeGreaterThan(0); // TCP: arrives anyway
    await waitFor(() => server.quakes.length === 1, 2000);
  });

  it("Wi-Fi off: the motors stop at once and both sides see the lost link; Wi-Fi on: back again", async () => {
    const { server, board } = await pair();
    server.vibrate(15, 1, 5000, 0);
    await waitFor(() => board.motorPower()[0] > 0, 1000);
    board.setWifi(false);
    expect(board.linkState).toBe("searching");
    expect(board.motorPower()).toEqual([0, 0, 0, 0]);
    await waitFor(() => !server.metrics().connected, 4500);
    board.setWifi(true);
    await waitFor(() => board.connected && server.metrics().connected, 4000);
    expect(board.stats.connects).toBe(2);
  }, 15000);

  it("a server restart (new session number) is found and the board connects again", async () => {
    const { server, board, port } = await pair();
    const oldSid = server.link.sid;
    await server.close();
    open.splice(open.indexOf(server), 1);
    await waitFor(() => board.linkState === "searching", 3000);
    const again = new ServerEmulator({ port, host: "127.0.0.1", seed: 4 });
    open.push(again);
    await again.start();
    await waitFor(() => board.connected, 5000);
    expect(again.link.sid).not.toBe(oldSid);
    expect(board.stats.sidChanges).toBe(1);
    await waitFor(() => board.stats.statesReceived > 0, 1000);
  }, 15000);
});
