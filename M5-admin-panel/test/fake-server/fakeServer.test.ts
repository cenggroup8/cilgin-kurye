import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test, type TestContext } from 'node:test';
import { AdminConnection, type AdminUpdate } from '../../src/comm/connection.ts';
import { PARAMS } from '../../../M1-game-server/src/admin/param-list.ts';
import { attachFakeServer, METRICS_MS, STATE_MS, type FakeServerOptions } from './fakeServer.ts';
import { makeRecording } from './recording.ts';

test('the snapshot has the full M1-5 parameter list, the state, metrics, board data and the log', { timeout: 5000 }, async (t) => {
  const { connection, fake } = await setup(t, { phase: 'playing' });
  for (let i = 0; i < 20; i++) fake.step(STATE_MS);
  const snapshot = await next(connection, (e) => e.t === 'snapshot', () => connection.start());
  assert.ok(snapshot.t === 'snapshot');
  assert.equal(snapshot.params.length, PARAMS.length);
  assert.deepEqual(snapshot.params.find((p) => p.name === 'game.bots'),
    { name: 'game.bots', group: 'game', label: PARAMS[0].label, integer: true, value: 8, min: 0, max: 8 });
  assert.equal(snapshot.state.phase, 'playing');
  assert.equal(snapshot.state.players.length, 8);
  assert.ok(snapshot.metrics.some((m) => m.name === 'net.0.ping_ms'));
  assert.ok(snapshot.board.connected);
  assert.ok(snapshot.board.samples.some((m) => m.name === 'board.accel_g'));
  assert.ok(snapshot.events.length > 0);
});

test('param_set: ok and a param notice for a good value, the M1-5 errors for wrong ones', { timeout: 5000 }, async (t) => {
  const { connection, fake } = await setup(t);
  const updates: AdminUpdate[] = [];
  connection.subscribe((e) => updates.push(e));
  await connected(connection);
  const set = (name: string, value: number) => connection.command({ name: 'param_set', args: { name, value } });
  assert.deepEqual(await set('physics.grip', 0.8), { ok: true });
  assert.deepEqual(await set('physics.grip', 7), { ok: false, error: 'out_of_range' });
  assert.deepEqual(await set('game.bots', 2.5), { ok: false, error: 'bad_value' });
  assert.deepEqual(await set('physics.nothing', 1), { ok: false, error: 'unknown_param' });
  assert.equal(fake.param('physics.grip')?.value, 0.8);
  assert.deepEqual(updates.filter((e) => e.t === 'param'), [{ t: 'param', name: 'physics.grip', value: 0.8 }]);
  assert.deepEqual(updates.flatMap((e) => e.t === 'mark' ? [e.mark.name] : []), ['physics.grip']);

  const list = next(connection, (e) => e.t === 'params');
  assert.deepEqual(await connection.command({ name: 'param_reset' }), { ok: true });
  const reset = await list;
  assert.ok(reset.t === 'params');
  assert.equal(reset.list.find((p) => p.name === 'physics.grip')?.value, 1);
});

test('game commands follow the phase table of M1-5 and the recording plays', { timeout: 5000 }, async (t) => {
  const { connection, fake } = await setup(t);
  await connected(connection);
  assert.deepEqual(await connection.command({ name: 'pause' }), { ok: false, error: 'wrong_phase' });
  assert.deepEqual(await connection.command({ name: 'quake', args: { mag: 5, zone: 4 } }), { ok: false, error: 'wrong_phase' });
  assert.deepEqual(await connection.command({ name: 'start' }), { ok: true });
  assert.equal(fake.phase, 'countdown');
  for (let i = 0; i < 3000 / STATE_MS; i++) fake.step(STATE_MS);
  assert.equal(fake.phase, 'playing');
  assert.deepEqual(await connection.command({ name: 'quake', args: { mag: 11, zone: 4 } }), { ok: false, error: 'bad_args' });
  assert.deepEqual(await connection.command({ name: 'obstacle_add', args: { type: 'puddle', segment: 70, lane: 0, pos: 0.5 } }),
    { ok: false, error: 'unknown_road' });
  assert.deepEqual(await connection.command({ name: 'obstacle_add', args: { type: 'puddle', segment: 7, lane: 1, pos: 0.5 } }), { ok: true });
  assert.deepEqual(await connection.command({ name: 'obstacle_remove', args: { id: 999 } }), { ok: false, error: 'unknown_obstacle' });

  // Two minutes of the recorded game: scores and deliveries come in.
  for (let i = 0; i < 120_000 / STATE_MS; i++) fake.step(STATE_MS);
  const { state, metrics } = fake.snapshot();
  const scores = metrics.filter((m) => m.name.startsWith('score.')).slice(-4).map((m) => m.value);
  assert.ok(scores.some((s) => s > 0), `scores ${scores}`);
  assert.ok(metrics.some((m) => m.name === 'delivery.time_s'));
  assert.ok(state.timeLeftSeconds < 300 - 100);

  assert.deepEqual(await connection.command({ name: 'pause' }), { ok: true });
  const left = fake.snapshot().state.timeLeftSeconds;
  for (let i = 0; i < 10; i++) fake.step(STATE_MS);
  assert.equal(fake.snapshot().state.timeLeftSeconds, left, 'time stops in a pause');
  assert.deepEqual(await connection.command({ name: 'end' }), { ok: true });
  assert.equal(fake.phase, 'ended');
});

test('a network delay set by the admin shows up in the measured ping', { timeout: 5000 }, async (t) => {
  const { connection, fake } = await setup(t, { phase: 'playing' });
  await connected(connection);
  const ping = () => {
    for (let i = 0; i < METRICS_MS / STATE_MS; i++) fake.step(STATE_MS);
    return fake.snapshot().metrics.filter((m) => m.name === 'net.2.ping_ms').at(-1)!.value;
  };
  assert.ok(ping() < 20);
  assert.deepEqual(await connection.command({ name: 'param_set', args: { name: 'net.2.up.delay_ms', value: 150 } }), { ok: true });
  const measured = ping();
  assert.ok(measured >= 156 && measured < 170, `ping ${measured}`);
});

test('after a drop the page gets the changed values again; a second admin replaces the first', { timeout: 5000 }, async (t) => {
  const { connection, fake, url } = await setup(t, { phase: 'playing' });
  await connected(connection);
  assert.deepEqual(await connection.command({ name: 'param_set', args: { name: 'game.penalty_s', value: 7 } }), { ok: true });
  fake.setBoardConnected(false);
  const resynced = next(connection, (e) => e.t === 'snapshot');
  fake.drop();
  const event = await resynced;
  assert.ok(event.t === 'snapshot');
  assert.equal(event.params.find((p) => p.name === 'game.penalty_s')?.value, 7);
  assert.equal(event.board.connected, false);

  const second = new AdminConnection(url);
  t.after(() => second.stop());
  const replaced = next(connection, (e) => e.t === 'connection' && e.status === 'replaced');
  await connected(second);
  await replaced;
  assert.deepEqual(await second.command({ name: 'new_code' }), { ok: true });
});

test('the recording is the same for the same seed', () => {
  assert.deepEqual(makeRecording(7), makeRecording(7));
  assert.notDeepEqual(makeRecording(7).events, makeRecording(8).events);
  for (const rider of makeRecording().players) {
    for (const [r, c] of rider.loop) assert.ok(r >= 0 && r <= 5 && c >= 0 && c <= 5, `rider ${rider.id} leaves the city`);
  }
});

async function setup(t: TestContext, options: FakeServerOptions = {}) {
  const server = createServer();
  const fake = attachFakeServer(server, { autoplay: false, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `ws://127.0.0.1:${address.port}/ws/admin`;
  const connection = new AdminConnection(url);
  t.after(() => { connection.stop(); fake.close(); server.close(); });
  return { connection, fake, url };
}

function connected(connection: AdminConnection) {
  return next(connection, (e) => e.t === 'connection' && e.status === 'connected', () => connection.start());
}

function next(connection: AdminConnection, matches: (e: AdminUpdate) => boolean, action?: () => void) {
  return new Promise<AdminUpdate>((resolve) => {
    const unsubscribe = connection.subscribe((event) => {
      if (!matches(event)) return;
      resolve(event);
      queueMicrotask(() => unsubscribe());
    });
    action?.();
  });
}
