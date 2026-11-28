// M5-4 (#51) against the fake server of M5-2 (#83), through the real communication manager.
// Done criteria: every graph fills with the recorded game; a parameter change shows on every
// graph at the same time; the CSV file holds the values of the graphs; a long run stays fast.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test, type TestContext } from 'node:test';
import { AdminConnection, type AdminUpdate } from '../../src/comm/connection.ts';
import { CHARTS, chartData, chartsInUse } from '../../src/graphs/charts.ts';
import { csvRows, toCsv } from '../../src/graphs/csv.ts';
import { GraphModel } from '../../src/graphs/model.ts';
import { attachFakeServer, STATE_MS, type FakeServerOptions } from '../fake-server/fakeServer.ts';

const SERVER_AHEAD_MS = 3_600_000;

async function setup(t: TestContext, options: FakeServerOptions = {}) {
  const server = createServer();
  // The fake server's clock runs one hour ahead of the admin's, like a second laptop.
  let serverTime = Date.now() + SERVER_AHEAD_MS;
  const fake = attachFakeServer(server, { autoplay: false, phase: 'playing', now: () => serverTime, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const connection = new AdminConnection(`ws://127.0.0.1:${address.port}/ws/admin`);
  const model = new GraphModel();
  connection.subscribe((e) => model.apply(e));
  t.after(() => { connection.stop(); fake.close(); server.close(); });
  /** Plays `ms` of the recorded game, with the server clock moving along. */
  const play = (ms: number) => {
    for (let done = 0; done < ms; done += STATE_MS) {
      serverTime += STATE_MS;
      fake.step(STATE_MS);
    }
  };
  return { connection, fake, model, play };
}

function next(connection: AdminConnection, matches: (e: AdminUpdate) => boolean, action?: () => void) {
  return new Promise<AdminUpdate>((resolve) => {
    const stop = connection.subscribe((e) => {
      if (!matches(e)) return;
      resolve(e);
      queueMicrotask(() => stop());
    });
    action?.();
  });
}

const connected = (c: AdminConnection) => next(c, (e) => e.t === 'connection' && e.status === 'connected', () => c.start());
const settle = () => new Promise((ok) => setTimeout(ok, 150));

test('every graph fills with the recorded game', { timeout: 10_000 }, async (t) => {
  const { connection, model, play } = await setup(t);
  play(60_000);
  await connected(connection);
  play(5_000);
  await settle();
  const used = chartsInUse(model).map((c) => c.id);
  assert.deepEqual(used, CHARTS.map((c) => c.id), 'all graphs of the table, and no unknown metric');
  const to = model.latestTime();
  for (const chart of chartsInUse(model)) {
    const d = chartData(model, chart, to - 120_000, to);
    assert.ok(d.times.length > 0, `${chart.id} has values`);
    assert.ok(d.values.every((row) => row.some((v) => v !== null)), `${chart.id}: every line has a value`);
  }
  const ping = chartData(model, CHARTS.find((c) => c.id === 'ping')!, to - 120_000, to);
  assert.equal(ping.lines.length, 9, '8 players and the board');
});

test('a parameter change puts one line on every graph at the same moment, at server time', { timeout: 10_000 }, async (t) => {
  const { connection, model, play } = await setup(t);
  await connected(connection);
  play(3_000);
  await settle();
  assert.deepEqual(await connection.command({ name: 'param_set', args: { name: 'physics.npc_count', value: 50 } }), { ok: true });
  play(3_000);
  await settle();
  const changes = model.allMarks().filter((m) => m.kind === 'change');
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.label, 'physics.npc_count');
  // The admin clock is an hour behind, but the line is where the server's samples are.
  const to = model.latestTime();
  assert.ok(Math.abs(changes[0]!.time - (to - 3_000)) < 1_500, 'the mark is among the samples, not an hour away');
  const seen = chartsInUse(model).map((c) => chartData(model, c, to - 60_000, to).marks.filter((m) => m.kind === 'change').map((m) => m.time));
  assert.ok(seen.every((times) => times.length === 1 && times[0] === changes[0]!.time));
  // And the effect: more cars, slower traffic after the line.
  const cars = model.points('traffic.car_count');
  assert.equal(cars.at(-1)!.value, 50);
});

test('an earthquake from the panel is marked on the seismic graph with its strength and zone', { timeout: 10_000 }, async (t) => {
  const { connection, model, play } = await setup(t);
  await connected(connection);
  play(2_000);
  assert.deepEqual(await connection.command({ name: 'quake', args: { mag: 6.5, zone: 4 } }), { ok: true });
  play(2_000);
  await settle();
  const quakes = model.allMarks().filter((m) => m.kind === 'quake');
  assert.equal(quakes.length, 1);
  assert.equal(quakes[0]!.mag, 6.5);
  assert.equal(quakes[0]!.zone, 4);
  assert.match(quakes[0]!.label, /^M6\.5 · merkez/);
  const to = model.latestTime();
  const seismic = chartData(model, CHARTS.find((c) => c.id === 'seismic')!, to - 60_000, to);
  assert.equal(seismic.marks.filter((m) => m.kind === 'quake').length, 1);
  const score = chartData(model, CHARTS.find((c) => c.id === 'scores')!, to - 60_000, to);
  assert.equal(score.marks.filter((m) => m.kind === 'quake').length, 0);
});

test('after a lost link the graphs fill again from the history, with no value twice', { timeout: 10_000 }, async (t) => {
  const { connection, fake, model, play } = await setup(t);
  await connected(connection);
  play(10_000);
  await settle();
  const before = model.points('net.0.ping_ms').length;
  fake.drop();
  await next(connection, (e) => e.t === 'connection' && e.status === 'reconnecting');
  play(10_000); // the game goes on while the admin is away
  await next(connection, (e) => e.t === 'snapshot');
  await settle();
  const pts = model.points('net.0.ping_ms');
  assert.ok(pts.length >= before + 19, 'the 10 s without a link came back from the history');
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i]!.time > pts[i - 1]!.time, 'in order, one value per time');
});

test('the CSV file holds exactly the values that the graphs show', { timeout: 10_000 }, async (t) => {
  const { connection, model, play } = await setup(t);
  await connected(connection);
  play(20_000);
  await connection.command({ name: 'param_set', args: { name: 'physics.top_speed_mps', value: 20 } });
  play(5_000);
  await settle();
  const csv = toCsv(csvRows(model)).slice(1).trim().split('\r\n').slice(1).map((line) => line.split(','));
  const fromCsv = new Map<string, Array<[number, number]>>();
  for (const [, ms, kind, , , metric, value] of csv) {
    if (kind !== 'sample') continue;
    const list = fromCsv.get(metric!) ?? [];
    list.push([Number(ms), Number(value)]);
    fromCsv.set(metric!, list);
  }
  for (const chart of chartsInUse(model)) {
    const d = chartData(model, chart, model.earliestTime(), model.latestTime());
    d.lines.forEach((line, i) => {
      const drawn = d.times.flatMap((time, k) => (d.values[i]![k] === null ? [] : [[time, d.values[i]![k]!] as [number, number]]));
      assert.deepEqual(fromCsv.get(line.metric), drawn, `${chart.id} · ${line.name}`);
    });
  }
  assert.equal(csv.filter((r) => r[2] === 'change').length, 1);
});

test('after a page reload the change lines come back from the snapshot, at the same place', { timeout: 10_000 }, async (t) => {
  const { connection, fake, model, play } = await setup(t);
  await connected(connection);
  play(3_000);
  await settle();
  await connection.command({ name: 'param_set', args: { name: 'physics.npc_count', value: 40 } });
  play(3_000);
  await settle();
  const before = model.allMarks().filter((m) => m.kind === 'change');
  assert.equal(before.length, 1);

  // A reloaded page: a new connection and a new, empty graph model.
  connection.stop();
  const again = new AdminConnection(connection['url'] as string);
  const fresh = new GraphModel();
  again.subscribe((e) => fresh.apply(e));
  t.after(() => again.stop());
  await next(again, (e) => e.t === 'snapshot', () => again.start());
  await settle();
  const after = fresh.allMarks().filter((m) => m.kind === 'change');
  assert.deepEqual(after.map((m) => m.label), ['physics.npc_count']);
  assert.ok(Math.abs(after[0]!.time - before[0]!.time) < 1_500, 'the line stands where it stood before the reload');
  void fake;
});
