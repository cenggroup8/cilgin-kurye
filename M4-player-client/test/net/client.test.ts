// M4-3 (#45): the network client against a server that speaks the contract, on real sockets.
// Done criteria: after a page reload and after a lost Wi-Fi the same player comes back;
// a broken message does not break the page.
import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { encode } from "@msgpack/msgpack";
import { NetClient, type NetEvent } from "../../src/net/client.ts";
import { memoryStore, type KeyValueStore } from "../../src/net/storage.ts";
import { ContractServer, waitFor } from "./contract-server.ts";

let server: ContractServer;
const clients: NetClient[] = [];

before(async () => {
  server = await ContractServer.start();
});
after(async () => {
  await server.stop();
});
afterEach(() => {
  clients.splice(0).forEach((c) => c.close());
  server.reset();
});

function client(store: KeyValueStore = memoryStore(), extra: Partial<ConstructorParameters<typeof NetClient>[0]> = {}): { c: NetClient; events: NetEvent[] } {
  const c = new NetClient({ url: server.url, store, retryMinMs: 50, retryMaxMs: 200, silenceMs: 600, ...extra });
  const events: NetEvent[] = [];
  c.subscribe((e) => events.push(e));
  clients.push(c);
  return { c, events };
}

async function connected(c: NetClient): Promise<void> {
  await waitFor(() => c.connection === "connected");
}

describe("joining", () => {
  it("says hello with the saved key, then joins a team", async () => {
    const { c, events } = client();
    c.hello("Ayşe", server.code);
    await connected(c);
    const hello = server.messages("hello").find((r) => r.msg.key === c.key)!;
    assert.deepEqual(hello.msg, { t: "hello", key: c.key, name: "Ayşe", code: server.code });
    assert.equal(c.player?.returning, false);
    assert.ok(c.join(2));
    await waitFor(() => c.player?.team === 2);
    assert.equal(c.player?.color, "purple");
    assert.deepEqual(events.map((e) => e.t).filter((t) => t !== "state"), ["connection", "connection", "welcome", "joined"]);
    assert.equal(c.join(7), false, "team out of range is not sent");
  });

  it("a wrong game code is refused and the client does not try again", async () => {
    const { c, events } = client();
    c.hello("x", "000000");
    await waitFor(() => c.connection === "refused");
    assert.equal(c.refusedWith, "bad_code");
    assert.ok(events.some((e) => e.t === "refused" && e.reason === "bad_code"));
    const links = c.stats.links;
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(c.stats.links, links);
  });

  it("the same key on a second page: the old page stops and does not take the player back", async () => {
    const store = memoryStore();
    const first = client(store).c;
    first.hello("a", server.code);
    await connected(first);
    const second = client(store).c;
    second.hello("a", server.code);
    await connected(second);
    await waitFor(() => first.connection === "replaced");
    await new Promise((ok) => setTimeout(ok, 300));
    assert.equal(second.connection, "connected");
    assert.equal(server.linksOf(first.key), 1);
  });
});

describe("in the game", () => {
  it("gives every state once, in order, and answers pings", async () => {
    const { c, events } = client();
    c.setFps(57.3);
    c.hello("p", server.code);
    await connected(c);
    await waitFor(() => c.stats.statesIn >= 5);
    const seqs = events.flatMap((e) => (e.t === "state" ? [e.update.seq] : []));
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
    assert.equal(new Set(seqs).size, seqs.length);
    const pong = await waitFor(() => server.messages("pong").find((r) => r.player === c.player!.player));
    assert.equal(typeof pong.msg.id, "number");
    assert.equal(pong.msg.fps, 57.3);
    assert.ok(Math.abs((pong.msg.ct as number) - Date.now()) < 2000);
    assert.ok((pong.msg.last as number) >= 0);
  });

  it("sends controls with their number and refuses values outside the contract", async () => {
    const { c } = client();
    assert.equal(c.sendControl({ seq: 1, throttle: 1, brake: 0, steer: 0 }), false, "not connected yet");
    c.hello("p", server.code);
    await connected(c);
    assert.ok(c.sendControl({ seq: 1, throttle: 1, brake: 0, steer: -1 }));
    assert.equal(c.sendControl({ seq: 2, throttle: 1, brake: 0, steer: 1.5 }), false);
    assert.equal(c.sendControl({ seq: 0, throttle: 1, brake: 0, steer: 0 }), false);
    const got = await waitFor(() => server.messages("control").find((r) => r.player === c.player!.player));
    assert.deepEqual(got.msg, { t: "control", seq: 1, throttle: 1, brake: 0, steer: -1 });
    assert.equal(c.stats.controlsDropped, 3);
  });

  it("frame rate limit from the admin", async () => {
    const { c, events } = client();
    c.hello("p", server.code);
    await connected(c);
    server.sendTo(c.key, encode({ t: "net", fps_limit: 30 }));
    await waitFor(() => c.fpsLimit === 30);
    assert.ok(events.some((e) => e.t === "net" && e.fpsLimit === 30));
  });
});

describe("coming back (done criteria of #45)", () => {
  it("after a page reload the same player comes back, and its control numbers go on", async () => {
    const store = memoryStore();
    const before = client(store).c;
    before.hello("p", server.code);
    await connected(before);
    for (let seq = 1; seq <= 40; seq++) before.sendControl({ seq, throttle: 1, brake: 0, steer: 0 });
    const player = before.player!.player;
    const lastWire = await waitFor(() => {
      const mine = server.messages("control").filter((r) => r.player === player);
      return mine.length === 40 ? (mine.at(-1)!.msg.seq as number) : undefined;
    });
    before.close();

    // The reloaded page: a new client with the same browser storage. M4-2 counts from 1 again.
    const after = client(store).c;
    after.hello("p", server.code);
    await connected(after);
    assert.equal(after.key, before.key);
    assert.equal(after.player?.player, player);
    // `returning` can be false here: a fast reload may say hello before the server has seen
    // the old link close. M2-1 then hands the place over (4002 to the old link); same player.
    after.sendControl({ seq: 1, throttle: 0, brake: 1, steer: 0 });
    const first = await waitFor(() => server.messages("control").filter((r) => r.player === player)[40]);
    assert.ok((first.msg.seq as number) > lastWire, "the server sees a bigger number than before the reload");
    assert.equal(after.toLocalSeq(first.msg.seq as number), 1, "the page gets its own numbering back");
  });

  it("after the link drops, the client comes back by itself as the same player", async () => {
    const { c, events } = client();
    c.hello("p", server.code);
    await connected(c);
    const player = c.player!.player;
    server.drop(c.key);
    await waitFor(() => c.connection === "reconnecting");
    await connected(c);
    assert.equal(c.player?.player, player);
    assert.equal(c.player?.returning, true);
    const states = events.filter((e) => e.t === "connection").map((e) => (e as { state: string }).state);
    assert.deepEqual(states, ["connecting", "connected", "reconnecting", "connected"]);
  });

  it("a silent link (dead Wi-Fi without a close) is noticed and opened again", async () => {
    const { c } = client();
    c.hello("p", server.code);
    await connected(c);
    const links = c.stats.links;
    server.talking = false;
    await waitFor(() => c.connection === "reconnecting", 3000);
    server.talking = true;
    await connected(c);
    assert.ok(c.stats.links > links);
    await waitFor(() => c.stats.statesIn > 0);
  });

  it("a Find me pressed while the link is down goes out when it comes back", async () => {
    const { c } = client();
    c.hello("p", server.code);
    await connected(c);
    const player = c.player!.player;
    server.drop(c.key);
    await waitFor(() => c.connection === "reconnecting");
    c.findMe();
    await connected(c);
    await waitFor(() => server.messages("find_me").some((r) => r.player === player));
  });

  it("after a server restart the client joins again with the saved code", async () => {
    const { c } = client();
    c.hello("p", server.code);
    await connected(c);
    await waitFor(() => c.lastStateSeq > 10);
    const port = server.port;
    await server.stop();
    await waitFor(() => c.connection === "reconnecting");
    server = new ContractServer();
    await server.listen(port);
    await connected(c);
    // The new server counts ticks from 1 again; the client takes them.
    await waitFor(() => c.stats.statesIn > 0 && c.lastStateSeq < 100 && c.lastStateSeq > 0);
  });
});

describe("broken messages", () => {
  it("never break the page; the client goes on", async () => {
    const { c } = client();
    c.subscribe(() => {
      throw new Error("a part of the page has a bug");
    });
    c.hello("p", server.code);
    await connected(c);
    const before = c.stats.statesIn;
    for (const bad of [
      Uint8Array.from([0xc1, 0xff]),
      encode([1, 2, 3]),
      encode({ t: "teleport" }),
      encode({ t: "state", seq: -1, s: {} }),
      encode({ t: "state", seq: 5 }),
      encode({ t: "welcome", player: 99, returning: false }),
      encode({ t: "ping", id: "x", st: 1 }),
      encode({ t: "net", fps_limit: 500 }),
    ]) server.sendTo(c.key, bad);
    server.sendTo(c.key, "{not json");
    await waitFor(() => c.stats.badMessages >= 9);
    await waitFor(() => c.stats.statesIn > before + 3);
    assert.equal(c.connection, "connected");
    assert.equal(c.fpsLimit, 0);
  });
});
