import type { Server } from 'node:http';
import { decode, encode } from '@msgpack/msgpack';
import { WebSocket, WebSocketServer } from 'ws';
import type { Control } from '../../src/controls/controls.ts';
import { recordedState, ticksPerSecond } from './recording.ts';

export const demoCode = 'DEMO';

interface Options {
  delayMs?: number;
  loss?: number;
  onControl?: (player: number, control: Control) => void;
}

interface Player {
  id: number;
  link?: WebSocket;
}

export function attachFakePlayerServer(http: Server, { delayMs = 0, loss = 0, onControl }: Options = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const known = new Map<string, Player>();
  http.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (link) => wss.emit('connection', link));
  });

  wss.on('connection', (link: WebSocket) => {
    let player: Player | undefined;
    let joined = false;
    let lastSeq = 0;
    let tick = 0;
    const pending = new Set<ReturnType<typeof setTimeout>>();
    const send = (message: object) => {
      if (link.readyState === WebSocket.OPEN) link.send(encode(message, { ignoreUndefined: true }));
    };
    const simulate = (action: () => void) => {
      if (loss > 0 && Math.random() < loss) return;
      if (!delayMs) return action();
      const timer = setTimeout(() => {
        pending.delete(timer);
        action();
      }, delayMs);
      pending.add(timer);
    };
    const publishState = () => {
      if (!joined || !player) return;
      const state = { t: 'state', seq: tick + 1, ...recordedState(tick), lastControlSeq: lastSeq };
      tick++;
      simulate(() => send(state));
    };
    const playback = setInterval(publishState, 1000 / ticksPerSecond);
    const pings = setInterval(() => {
      if (player) send({ t: 'ping', serverTime: Date.now() });
    }, 500);

    link.on('message', (bytes, binary) => {
      if (!binary || !Buffer.isBuffer(bytes)) return;
      let message: Record<string, unknown>;
      try {
        const data = decode(bytes);
        if (!data || typeof data !== 'object') return;
        message = data as Record<string, unknown>;
      } catch {
        send({ t: 'error', reason: 'bad_message' });
        return;
      }
      if (!player) {
        const { t, key, name, code } = message;
        if (t !== 'hello' || typeof key !== 'string' || !key || typeof name !== 'string' || !name.trim()) {
          return send({ t: 'error', reason: 'bad_hello' });
        }
        if (code !== demoCode) return send({ t: 'error', reason: 'bad_code' });
        const previous = known.get(key);
        previous?.link?.close(4002, 'same player opened elsewhere');
        player = { id: previous?.id ?? known.size, link };
        known.set(key, player);
        send({ t: 'welcome', player: player.id, returning: previous !== undefined });
        return;
      }
      if (message.t === 'join') {
        const { team } = message;
        if (typeof team !== 'number' || !Number.isInteger(team) || team < 0 || team > 3) {
          return send({ t: 'error', reason: 'bad_join' });
        }
        joined = true;
        return send({ t: 'joined', player: player.id, team, color: ['blue', 'green', 'purple', 'yellow'][team] });
      }
      if (message.t === 'control' && joined) {
        const { seq, throttle, brake, steer } = message;
        if (!inRange(seq, 1, Number.MAX_SAFE_INTEGER) || !Number.isSafeInteger(seq) ||
            !inRange(throttle, 0, 1) || !inRange(brake, 0, 1) || !inRange(steer, -1, 1)) return;
        const session = player;
        simulate(() => {
          if (link.readyState !== WebSocket.OPEN || seq <= lastSeq) return;
          lastSeq = seq;
          onControl?.(session.id, { seq, throttle, brake, steer });
        });
      }
    });

    link.on('close', () => {
      if (player?.link === link) player.link = undefined;
      clearInterval(playback);
      clearInterval(pings);
      for (const timer of pending) clearTimeout(timer);
    });
  });
  return () => {
    for (const link of wss.clients) link.terminate();
    wss.close();
  };
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && value >= min && value <= max;
}
