import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test, type TestContext } from 'node:test';
import { AdminConnection, type AdminUpdate } from '../../src/comm/connection.ts';
import { attachAdminFixture } from './adminFixture.ts';

test('correlates replies and emits marks only for accepted commands', { timeout: 5000 }, async (t) => {
  const { connection, fixture } = await setup(t);
  const updates: AdminUpdate[] = [];
  connection.subscribe((event) => updates.push(event));
  await next(connection, (e) => e.t === 'connection' && e.status === 'connected', () => connection.start());
  const [start, invalid, change] = await Promise.all([
    connection.command({ name: 'start' }),
    connection.command({ name: 'quake', args: { mag: 11, zone: 4 } }),
    connection.command({ name: 'param_set', args: { name: 'physics.top_speed_mps', value: 22 } }),
  ]);
  assert.deepEqual([start, invalid, change], [{ ok: true }, { ok: false, error: 'bad_args' }, { ok: true }]);
  assert.deepEqual(fixture.commands.map(({ id }) => id), [1, 2, 3]);
  assert.deepEqual(updates.flatMap((e) => e.t === 'mark' ? [e.mark.name] : []), ['start', 'physics.top_speed_mps']);
});

test('reloads the full snapshot after a drop and stops retrying if replaced', { timeout: 5000 }, async (t) => {
  const { connection, fixture, url } = await setup(t);
  await next(connection, (e) => e.t === 'snapshot', () => connection.start());
  fixture.snapshot.params[0].value = 26;
  fixture.snapshot.state.gameCode = 'NEXT';
  fixture.snapshot.metrics.push({ name: 'traffic.car_count', time: Date.now(), value: 2 });
  fixture.snapshot.board.connected = false;
  const reconnecting = next(connection, (e) => e.t === 'connection' && e.status === 'reconnecting');
  const resynced = next(connection, (e) => e.t === 'snapshot');
  fixture.drop();
  await reconnecting;
  assert.deepEqual(await connection.command({ name: 'start' }), { ok: false, error: 'not_connected' });
  const event = await resynced;
  assert.ok(event.t === 'snapshot');
  assert.equal(event.params[0].value, 26);
  assert.equal(event.state.gameCode, 'NEXT');
  assert.equal(event.metrics.at(-1)?.value, 2);
  assert.equal(event.board.connected, false);

  const second = new AdminConnection(url);
  t.after(() => second.stop());
  const replaced = next(connection, (e) => e.t === 'connection' && e.status === 'replaced');
  await next(second, (e) => e.t === 'connection' && e.status === 'connected', () => second.start());
  await replaced;
  assert.deepEqual(await connection.command({ name: 'start' }), { ok: false, error: 'not_connected' });
  assert.deepEqual(await second.command({ name: 'start' }), { ok: true });
});

async function setup(t: TestContext) {
  const server = createServer();
  const fixture = attachAdminFixture(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `ws://127.0.0.1:${address.port}/ws/admin`;
  const connection = new AdminConnection(url);
  t.after(() => { connection.stop(); fixture.close(); server.close(); });
  return { connection, fixture, url };
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
