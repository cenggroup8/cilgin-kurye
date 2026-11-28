import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startM2Server, type M2Server } from "../src/server.js";
import { RecordingM1, TestLink, waitFor } from "./helpers.js";

let server: M2Server;
let m1: RecordingM1;
let links: TestLink[] = [];

async function phone(): Promise<TestLink> {
  const l = await TestLink.open(server.port);
  links.push(l);
  return l;
}

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "m2-1-"));
  mkdirSync(join(dir, "models"));
  writeFileSync(join(dir, "models", "store.glb"), "GLB");
  writeFileSync(join(dir, "city_plan.json"), '{"version":"test"}');
  m1 = new RecordingM1();
  server = await startM2Server({
    port: 0,
    publicHost: "192.168.1.20",
    events: m1,
    paths: { modelsDir: join(dir, "models"), cityPlanFile: join(dir, "city_plan.json") },
  });
});

afterEach(async () => {
  links.forEach((l) => l.close());
  links = [];
  await server.close();
});

const get = (path: string) => fetch(`http://127.0.0.1:${server.port}${path}`);

describe("web server and join", () => {
  it("serves the phone and admin pages, the models and the city plan", async () => {
    expect((await get("/")).status).toBe(200);
    expect(await (await get("/admin")).text()).toContain("/ws/admin");
    expect(await (await get("/models/store.glb")).text()).toBe("GLB");
    expect(await (await get("/city_plan.json")).json()).toEqual({ version: "test" });
    expect((await get("/vendor/msgpack.js")).status).toBe(200);
    // "%2f" keeps the client from cleaning the path, so the server sees "../".
    expect((await get("/models/..%2fcity_plan.json")).status).toBe(404);
  });

  it("the QR code holds the address of the main computer and the game code", async () => {
    const info = await (await get("/join")).json();
    expect(info.code).toMatch(/^\d{6}$/);
    expect(info.url).toBe(`http://192.168.1.20:${server.port}/?code=${info.code}`);
    const svg = await (await get("/qr.svg")).text();
    expect(svg).toContain("<svg");
  });

  it("a new game code is used from then on", async () => {
    const old = server.gameCode.value;
    const next = server.newGameCode();
    expect(next).not.toBe(old);
    expect((await (await get("/join")).json()).code).toBe(next);
  });
});

describe("sessions and access", () => {
  it("a phone joins with the code and its team goes to M1", async () => {
    const p = await phone();
    expect(await p.hello("key-a", server.gameCode.value, "Ayşe")).toEqual({ t: "welcome", player: 0, returning: false });
    p.send({ t: "join", team: 1 });
    expect(await waitFor(() => m1.events[0])).toEqual({ type: "join", playerKey: "key-a", playerNo: 0, name: "Ayşe", team: 1 });
  });

  it("a wrong code is rejected and the link is closed", async () => {
    const p = await phone();
    expect(await p.hello("key-a", "000000")).toEqual({ t: "error", reason: "bad_code" });
    expect(await p.closed()).toBe(4003);
  });

  it("after a reload the same player number comes back, and M1 hears lost and returned", async () => {
    const code = server.gameCode.value;
    await (await phone()).hello("key-a", code);
    const b = await phone();
    await b.hello("key-b", code);
    b.close();
    await waitFor(() => m1.events.find((e) => e.type === "lost"));
    const b2 = await phone();
    expect(await b2.hello("key-b", code)).toEqual({ t: "welcome", player: 1, returning: true });
    expect(m1.events.map((e) => e.type)).toEqual(["lost", "returned"]);
  });

  it("the 9th player is rejected", async () => {
    const code = server.gameCode.value;
    for (let i = 0; i < 8; i++) expect((await (await phone()).hello(`k${i}`, code)).player).toBe(i);
    const ninth = await phone();
    expect(await ninth.hello("k8", code)).toEqual({ t: "error", reason: "full" });
  });

  it("a second admin login drops the first one", async () => {
    const a1 = await TestLink.open(server.port, "/ws/admin");
    links.push(a1);
    await waitFor(() => server.registry.adminConn ?? undefined);
    const a2 = await TestLink.open(server.port, "/ws/admin");
    links.push(a2);
    expect(await a1.closed()).toBe(4001);
    expect(a2.closeCode).toBeNull();
  });

  it("a message before the hello is refused", async () => {
    const p = await phone();
    p.send({ t: "join", team: 0 });
    expect(await p.next("error")).toEqual({ t: "error", reason: "bad_hello" });
    expect(await p.closed()).toBe(4003);
    expect(m1.events).toEqual([]);
  });
});
