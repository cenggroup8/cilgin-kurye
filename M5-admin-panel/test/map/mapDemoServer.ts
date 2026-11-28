// Standalone demo server for the M5-3 map manager.
// Sends fake game states at 10 Hz over WebSocket so the map renders a moving game.

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { encode, decode } from '@msgpack/msgpack';
import { WebSocket, WebSocketServer } from 'ws';
import type { AdminMessage, Snapshot } from '../../src/comm/protocol.ts';
import { fakeGameStates } from './fake-state.ts';

const dist = new URL('../../dist/', import.meta.url);
const files = await Promise.all([
  ['/', 'index.html', 'text/html'],
  ['/main.js', 'main.js', 'text/javascript'],
  ['/main.css', 'main.css', 'text/css'],
].map(async ([path, name, type]) => [
  path, { body: await readFile(new URL(name, dist)), type },
] as const));
const routes = new Map(files);

const server = createServer((req, res) => {
  const file = routes.get((req.url ?? '').split('?')[0]);
  if (!file) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': `${file.type}; charset=utf-8` }).end(file.body);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
const now = Date.now();

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws/admin') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (link) => wss.emit('connection', link));
});

const gen = fakeGameStates(300, 100);  // 5 min of states

function nextState() {
  const { value, done } = gen.next();
  return done ? null : value;
}

let currentState = nextState();

wss.on('connection', (link: WebSocket) => {
  const send = (msg: AdminMessage) => {
    if (link.readyState === WebSocket.OPEN) link.send(encode(msg));
  };

  link.on('message', (data, binary) => {
    if (!binary || !Buffer.isBuffer(data)) return;
    try {
      const msg = decode(data) as Record<string, unknown>;
      if (msg?.t === 'snapshot_get') {
        send({
          t: 'snapshot',
          state: currentState!,
          params: [
            { name: 'physics.npc_count', group: 'physics', label: 'NPC araç sayısı', value: 20, min: 0, max: 60, integer: true },
            { name: 'physics.top_speed_mps', group: 'physics', value: 15, min: 5, max: 30 },
          ],
          metrics: [{ name: 'traffic.car_count', time: now, value: 20 }],
          board: { connected: true, samples: [{ name: 'board.delay_ms', time: now, value: 8 }] },
          events: [{ time: now, message: 'Harita demo başladı' }],
        } as Snapshot);
      } else if (msg?.t === 'cmd') {
        const id = msg.id as number;
        console.log('Command received:', JSON.stringify(msg));
        send({ t: 'reply', id, ok: true });
      }
    } catch { /* ignore malformed */ }
  });

  // Broadcast state at 10 Hz
  const interval = setInterval(() => {
    const state = nextState();
    if (!state) {
      clearInterval(interval);
      return;
    }
    currentState = state;
    send({ t: 'state', state });
  }, 100);

  link.on('close', () => clearInterval(interval));
});

const port = Number(process.env.M5_DEMO_PORT ?? 5176);
server.listen(port, '127.0.0.1', () => console.log(`Map demo: http://localhost:${port}`));
