import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { encode, decode } from '@msgpack/msgpack';
import { WebSocket } from 'ws';
import { attachFakePlayerServer } from './fakeServer.ts';
import { recordedState, recordingTicks } from './recording.ts';

test('recording covers all phases, a road closure, a fall and a quake', () => {
  const states = Array.from({ length: recordingTicks }, (_, tick) => recordedState(tick));
  assert.deepEqual(new Set(states.map(({ phase }) => phase)), new Set(['lobby', 'countdown', 'playing', 'paused', 'ended']));
  assert.equal(states.find(({ phase }) => phase === 'countdown')?.countdownTicksLeft, 90);
  assert.ok(states.some((state) => 'obstacles' in state));
  assert.ok(states.some((state) => 'fallen' in state));
  assert.ok(states.some((state) => 'quake' in state));
  const ending = states.at(-1);
  assert.ok(ending?.phase === 'ended');
  assert.deepEqual(ending.winners, [0]);
});

test('binary join, ordered controls, state playback and ping', { timeout: 4000 }, async (t) => {
  const server = createServer();
  const seen: number[] = [];
  const stop = attachFakePlayerServer(server, { onControl: (_, { seq }) => seen.push(seq) });
  server.listen(0, '127.0.0.1');
  t.after(() => { stop(); server.close(); });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  t.after(() => socket.terminate());
  await once(socket, 'open');
  const messages: Record<string, unknown>[] = [];
  socket.on('message', (bytes: Buffer) => messages.push(decode(bytes) as Record<string, unknown>));
  async function waitFor(type: string, predicate = (_: Record<string, unknown>) => true) {
    let message = messages.find((item) => item.t === type && predicate(item));
    while (!message) {
      await once(socket, 'message');
      message = messages.find((item) => item.t === type && predicate(item));
    }
    return message;
  }
  socket.send(encode({ t: 'hello', key: 'test', name: 'Kurye', code: 'DEMO' }));
  assert.equal((await waitFor('welcome')).returning, false);
  socket.send(encode({ t: 'join', team: 2 }));
  assert.equal((await waitFor('joined')).color, 'purple');
  for (const seq of [1, 3, 2]) socket.send(encode({ t: 'control', seq, throttle: 1, brake: 0, steer: -1 }));
  await waitFor('state', (message) => message.lastControlSeq === 3);
  assert.deepEqual(seen, [1, 3]);
  await waitFor('ping');
  assert.ok(messages.filter(({ t }) => t === 'state').length >= 10);
});
