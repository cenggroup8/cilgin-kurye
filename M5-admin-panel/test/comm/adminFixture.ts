import type { Server } from 'node:http';
import { encode, decode } from '@msgpack/msgpack';
import { WebSocket, WebSocketServer } from 'ws';
import type { AdminCommand, AdminMessage, Snapshot } from '../../src/comm/protocol.ts';

export function attachAdminFixture(server: Server) {
  let active: WebSocket | undefined;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const now = Date.now();
  const snapshot: Snapshot = {
    t: 'snapshot',
    state: {
      phase: 'lobby', timeLeftSeconds: 120, gameCode: 'DEMO',
      players: [{ id: 0, team: 0, x: 18, z: 18, fallen: false }],
      npcCars: [{ id: 0, x: 21, z: 3.5 }],
      obstacles: [],
      deliveryPoints: [{ id: 0, x: 50, z: 7 }],
    },
    params: [{ name: 'physics.top_speed_mps', group: 'physics', value: 15, min: 5, max: 40 }],
    metrics: [{ name: 'traffic.car_count', time: now - 500, value: 0 }, { name: 'traffic.car_count', time: now, value: 1 }],
    board: { connected: true, samples: [{ name: 'board.delay_ms', time: now, value: 12 }] },
    events: [{ time: now, message: 'Demo kaydı yüklendi' }],
  };

  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws/admin') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (link) => wss.emit('connection', link));
  });

  const commands: (AdminCommand & { id: number })[] = [];
  const send = (link: WebSocket, message: AdminMessage) => {
    if (link.readyState === WebSocket.OPEN) link.send(encode(message));
  };

  wss.on('connection', (link: WebSocket) => {
    active?.close(4001, 'replaced by a new admin login');
    active = link;
    link.on('close', () => { if (active === link) active = undefined; });
    link.on('message', (data, binary) => {
      if (active !== link || !binary || !Buffer.isBuffer(data)) return;
      let message;
      try {
        message = decode(data) as { t: string } & AdminCommand & { id: number };
        if (message?.t === 'snapshot_get') return send(link, snapshot);
      } catch {
        return;
      }
      if (message?.t !== 'cmd' || !Number.isSafeInteger(message.id)) return;
      const { id, ...command } = message;
      commands.push({ ...command, id });
      const fail = (error: string) => send(link, { t: 'reply', id, ok: false, error });
      const phase = snapshot.state.phase;
      switch (command.name) {
        case 'start':
          if (phase !== 'lobby') return fail('wrong_phase');
          snapshot.state.phase = 'playing';
          break;
        case 'pause':
          if (phase !== 'playing') return fail('wrong_phase');
          snapshot.state.phase = 'paused';
          break;
        case 'resume':
          if (phase !== 'paused') return fail('wrong_phase');
          snapshot.state.phase = 'playing';
          break;
        case 'end':
          if (phase !== 'playing' && phase !== 'paused') return fail('wrong_phase');
          snapshot.state.phase = 'ended';
          snapshot.state.timeLeftSeconds = 0;
          break;
        case 'quake':
          if (phase !== 'playing' && phase !== 'paused') return fail('wrong_phase');
          if (!command.args || !Number.isFinite(command.args.mag) || command.args.mag < 0 || command.args.mag > 10 ||
              !Number.isInteger(command.args.zone) || command.args.zone < -1 || command.args.zone > 8) {
            return fail('bad_args');
          }
          snapshot.board.quake = command.args;
          snapshot.board.samples = [
            ...snapshot.board.samples.filter(({ name }) => name !== 'quake.mag'),
            { name: 'quake.mag', time: Date.now(), value: command.args.mag },
          ];
          send(link, { t: 'board', board: snapshot.board });
          break;
        case 'param_set': {
          const param = snapshot.params.find(({ name }) => name === command.args?.name);
          const value = command.args?.value;
          if (!param || !Number.isFinite(value) || value < param.min || value > param.max) return fail('bad_args');
          param.value = value;
          send(link, { t: 'param', name: param.name, value });
          break;
        }
        default:
          return fail('unknown_command');
      }
      send(link, { t: 'state', state: snapshot.state });
      send(link, { t: 'reply', id, ok: true });
    });
  });

  return {
    commands, snapshot,
    drop: () => active?.terminate(),
    close() {
      for (const link of wss.clients) link.terminate();
      wss.close();
    },
  };
}
