import type { Server } from 'node:http';
import { decode, encode } from '@msgpack/msgpack';
import { WebSocket, WebSocketServer } from 'ws';
import { PARAMS } from '../../../M1-game-server/src/admin/param-list.ts';
import type {
  AdminMessage, AdminState, BoardData, LogEntry, MetricSample, Parameter, Phase, Snapshot,
} from '../../src/comm/protocol.ts';
import { makeRecording, OBSTACLE_TYPES, PLAYER_COUNT, positionAt, random, TEAMS, type Recording } from './recording.ts';

// Fake server for the admin page (M5-2, #49). It stands in for M2 and plays a recorded game
// with metrics, the parameter list and board data. It answers every command with "ok" or an
// error, like M1-5 (#61) and M1-4 (#67) would, and it can drop the connection on purpose.
//
// The parameter list is the one of M1-5 (M1-game-server/src/admin/param-list.ts), so a new
// parameter there shows up here and in the forms with no other change.
// The metric names and the snapshot, state, metrics and board messages are provisional
// until the shared admin messages come with M2-2 (#35). They are the ones of M5-1 (#73).

export const STATE_MS = 100; // 10 states per second (v2.1 section 9.3)
export const METRICS_MS = 500; // twice per second
const HISTORY_MS = 120_000; // the recent history after a reconnect
const COUNTDOWN_MS = 3000;
const SEGMENTS = 60;
const MAX_LANE = 4;

/** Phases in which each command is allowed, the same table as `ALLOWED` in M1-5. */
const ALLOWED: Readonly<Record<string, readonly Phase[]>> = {
  param_set: ['lobby', 'countdown', 'playing', 'paused', 'ended'],
  param_reset: ['lobby', 'countdown', 'playing', 'paused', 'ended'],
  new_code: ['lobby', 'countdown', 'playing', 'paused', 'ended'],
  reset: ['lobby', 'countdown', 'playing', 'paused', 'ended'],
  start: ['lobby'],
  pause: ['countdown', 'playing'],
  resume: ['paused'],
  end: ['countdown', 'playing', 'paused'],
  obstacle_add: ['playing', 'paused'],
  obstacle_remove: ['playing', 'paused'],
  road_close: ['playing', 'paused'],
  obstacle_ahead: ['playing', 'paused'],
  quake: ['playing', 'paused'],
};

export interface FakeServerOptions {
  /** WebSocket path. M2-1 (#58) serves the admin page on `/ws/admin`. */
  path?: string;
  /** Seed of the recorded game. */
  seed?: number;
  /** Phase at the start. `playing` lets the map and the graphs move at once. */
  phase?: 'lobby' | 'playing';
  /** Send states and metrics on timers. Tests turn it off and call `step()`. */
  autoplay?: boolean;
  /** Start the game again a few seconds after it ends. */
  loop?: boolean;
  /** The parameter list. Default: the list of M1-5 with its start values. */
  params?: readonly Parameter[];
  /** Clock in milliseconds. Default: `Date.now`. */
  now?: () => number;
}

export interface ReceivedCommand {
  id: number;
  name: string;
  args?: Record<string, unknown>;
}

type Obstacle = AdminState['obstacles'][number];

export function m1Params(): Parameter[] {
  return PARAMS.map(({ name, group, label, integer, start, min, max }) =>
    ({ name, group, label, integer: integer ?? false, value: start, min, max }));
}

export function attachFakeServer(server: Server, options: FakeServerOptions = {}) {
  const path = options.path ?? '/ws/admin';
  const now = options.now ?? Date.now;
  const recording: Recording = makeRecording(options.seed);
  const startParams = (options.params ?? m1Params()).map((p) => ({ ...p }));
  const params = new Map(startParams.map((p) => [p.name, { ...p }]));
  const noise = random(recording.seed + 1);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const commands: ReceivedCommand[] = [];
  let active: WebSocket | undefined;

  // Game.
  let phase: Phase = 'lobby';
  let pausedFrom: Phase = 'playing';
  let countdownMs = 0;
  let playedMs = 0;
  let endedMs = 0;
  let nextEvent = 0;
  let gameCode = '';
  let nextObstacleId = 1;
  let scores = new Array<number>(TEAMS).fill(0);
  let fallenUntil = new Array<number>(PLAYER_COUNT).fill(-1);
  let falls = 0;
  const obstacles = new Map<number, Obstacle>();
  const deliveryPoints = Array.from({ length: PLAYER_COUNT }, (_, id) => ({ id, x: 0, z: 0 }));
  // Board.
  let boardConnected = true;
  let quake: BoardData['quake'];
  let quakeUntil = -Infinity;
  // History for the snapshot.
  const metrics: MetricSample[] = [];
  const boardSamples: MetricSample[] = [];
  const events: LogEntry[] = [];
  let sinceMetrics = 0;

  const value = (name: string, fallback = 0) => params.get(name)?.value ?? fallback;

  function newCode() {
    gameCode = String(100000 + Math.floor(noise() * 900000));
  }

  function log(message: string) {
    events.push({ time: now(), message });
    if (events.length > 50) events.splice(0, events.length - 50);
    send({ t: 'event', entry: events.at(-1)! });
  }

  function resetGame() {
    phase = 'lobby';
    countdownMs = playedMs = endedMs = nextEvent = falls = 0;
    scores = new Array<number>(TEAMS).fill(0);
    fallenUntil = new Array<number>(PLAYER_COUNT).fill(-1);
    obstacles.clear();
    quake = undefined;
    quakeUntil = -Infinity;
    nextObstacleId = 1;
  }

  function state(): AdminState {
    const seconds = playedMs / 1000;
    const players = recording.players.map((rider) => {
      const fallen = fallenUntil[rider.id] > seconds;
      const { x, z } = positionAt(rider, seconds);
      return { id: rider.id, team: rider.team, x, z, fallen };
    });
    const npcCount = Math.min(recording.npcCars.length, Math.round(value('physics.npc_count', 20) / 5));
    const npcCars = recording.npcCars.slice(0, npcCount).map((car) => ({ id: car.id, ...positionAt(car, seconds) }));
    return {
      phase,
      timeLeftSeconds: Math.max(0, recording.seconds - seconds),
      gameCode,
      players,
      npcCars,
      obstacles: [...obstacles.values()],
      deliveryPoints: phase === 'lobby' ? [] : deliveryPoints,
    };
  }

  function board(): BoardData {
    return { connected: boardConnected, samples: boardSamples.slice(-20), ...(quake ? { quake } : {}) };
  }

  function snapshot(): Snapshot {
    return {
      t: 'snapshot',
      state: state(),
      params: [...params.values()],
      metrics: [...metrics],
      board: { ...board(), samples: [...boardSamples] },
      events: [...events],
    };
  }

  function send(message: AdminMessage) {
    if (active?.readyState === WebSocket.OPEN) active.send(encode(message));
  }

  /** Plays the recorded events up to the current game time. */
  function playEvents() {
    const seconds = playedMs / 1000;
    while (nextEvent < recording.events.length && recording.events[nextEvent].t <= seconds) {
      const e = recording.events[nextEvent++];
      switch (e.kind) {
        case 'delivery': {
          const team = recording.players[e.player].team;
          scores[team] += e.points;
          const point = deliveryPoints[e.player];
          point.x = Math.round(noise() * 5) * 100;
          point.z = Math.round(noise() * 5) * 100;
          metrics.push({ name: 'delivery.time_s', time: now(), value: e.timeS },
            { name: 'delivery.distance_m', time: now(), value: e.distanceM });
          break;
        }
        case 'fall':
          fallenUntil[e.player] = e.t + value('game.penalty_s', 3);
          falls++;
          break;
        case 'obstacle_add':
          obstacles.set(e.id, { id: e.id, type: e.type, segment: e.segment, lane: e.lane, pos: e.pos });
          break;
        case 'obstacle_remove':
          obstacles.delete(e.id);
          break;
        case 'quake':
          startQuake(e.mag, e.zone, 'kayıt');
          break;
      }
    }
  }

  function startQuake(mag: number, zone: number, source: string) {
    quake = { mag, zone };
    quakeUntil = now() + value('quake.duration_s', 5) * 1000;
    boardSamples.push({ name: 'quake.mag', time: now(), value: mag });
    log(`Deprem (${source}): büyüklük ${mag}, bölge ${zone}`);
    send({ t: 'board', board: board() });
  }

  function measure() {
    const t = now();
    const out: MetricSample[] = [];
    const put = (name: string, v: number) => out.push({ name, time: t, value: Number(v.toFixed(3)) });
    for (let team = 0; team < TEAMS; team++) put(`score.${team}`, scores[team]);
    const npcCount = value('physics.npc_count', 20);
    put('traffic.car_count', npcCount);
    const slowdown = 1 - 0.5 * npcCount / 60 - 0.03 * obstacles.size;
    put('traffic.npc_speed_mps', Math.max(1, value('physics.npc_speed_mps', 11) * slowdown));
    const seconds = playedMs / 1000;
    const moving = recording.players.filter((p) => fallenUntil[p.id] <= seconds);
    const topFactor = value('physics.top_speed_mps', 15) / 15;
    const meanSpeed = phase === 'playing' && moving.length > 0
      ? moving.reduce((s, p) => s + p.speedMps * topFactor, 0) / recording.players.length : 0;
    put('speed.mean_mps', meanSpeed);
    put('falls.total', falls);
    // The network emulator settings of M2-4 (#63) show up in the measured values.
    for (let p = 0; p < PLAYER_COUNT; p++) {
      const delay = value(`net.${p}.up.delay_ms`) + value(`net.${p}.down.delay_ms`);
      const jitter = value(`net.${p}.up.jitter_ms`) + value(`net.${p}.down.jitter_ms`);
      put(`net.${p}.ping_ms`, 6 + delay + jitter * noise() + 2 * noise());
      put(`net.${p}.jitter_ms`, 0.5 + jitter * (0.5 + 0.5 * noise()));
      put(`net.${p}.loss_pct`, loss(value(`net.${p}.up.loss_pct`), value(`net.${p}.down.loss_pct`)));
      const limit = value(`net.${p}.fps_limit`);
      put(`net.${p}.fps`, (limit > 0 ? Math.min(limit, 60) : 60) - 2 * noise());
    }
    if (boardConnected) {
      put('board.delay_ms', 10 + value('board.up.delay_ms') + value('board.down.delay_ms') +
        (value('board.up.jitter_ms') + value('board.down.jitter_ms')) * noise() + 3 * noise());
      put('board.loss_pct', loss(value('board.up.loss_pct'), value('board.down.loss_pct')));
    }
    metrics.push(...out);
    trim(metrics, t);
    send({ t: 'metrics', samples: out });

    if (boardConnected) {
      const shaking = t < quakeUntil;
      const g = 1 + (shaking ? (quake?.mag ?? 0) * 0.08 * (noise() - 0.5) : 0.01 * (noise() - 0.5));
      boardSamples.push({ name: 'board.accel_g', time: t, value: Number(g.toFixed(3)) });
      if (!shaking) quake = undefined;
      trim(boardSamples, t);
      send({ t: 'board', board: board() });
    }
  }

  function trim(samples: MetricSample[], t: number) {
    const first = samples.findIndex((s) => s.time >= t - HISTORY_MS);
    if (first > 0) samples.splice(0, first);
  }

  /** Moves the fake game forward. The timers call it; tests can call it with their own steps. */
  function step(ms: number) {
    if (phase === 'countdown') {
      countdownMs -= ms;
      if (countdownMs <= 0) {
        phase = 'playing';
        log('Oyun başladı');
      }
    } else if (phase === 'playing') {
      playedMs += ms;
      playEvents();
      if (playedMs >= recording.seconds * 1000) {
        phase = 'ended';
        log('Süre bitti');
      }
    } else if (phase === 'ended' && options.loop) {
      endedMs += ms;
      if (endedMs >= 5000) {
        resetGame();
        phase = 'playing';
        log('Kayıt baştan oynatılıyor');
      }
    }
    send({ t: 'state', state: state() });
    sinceMetrics += ms;
    if (sinceMetrics >= METRICS_MS) {
      sinceMetrics -= METRICS_MS;
      measure();
    }
  }

  function handle(cmd: ReceivedCommand) {
    commands.push(cmd);
    const reply = (error?: string) => send(error === undefined
      ? { t: 'reply', id: cmd.id, ok: true } : { t: 'reply', id: cmd.id, ok: false, error });
    const allowed = ALLOWED[cmd.name];
    if (!allowed) return reply('unknown_command');
    if (!allowed.includes(phase)) return reply('wrong_phase');
    const a = cmd.args ?? {};
    switch (cmd.name) {
      case 'param_set': {
        if (typeof a.name !== 'string') return reply('bad_args');
        const param = params.get(a.name);
        if (!param) return reply('unknown_param');
        const v = a.value;
        if (typeof v !== 'number' || !Number.isFinite(v) || (param.integer && !Number.isInteger(v))) return reply('bad_value');
        if (v < param.min || v > param.max) return reply('out_of_range');
        param.value = v;
        send({ t: 'param', name: param.name, value: v });
        return reply();
      }
      case 'param_reset':
        for (const p of startParams) params.set(p.name, { ...p });
        send({ t: 'params', list: [...params.values()] });
        return reply();
      case 'new_code':
        newCode();
        break;
      case 'reset':
        resetGame();
        log('Oyun sıfırlandı');
        break;
      case 'start':
        phase = 'countdown';
        countdownMs = COUNTDOWN_MS;
        break;
      case 'pause':
        pausedFrom = phase;
        phase = 'paused';
        break;
      case 'resume':
        // A pause during the countdown starts the countdown again (v2.1 section 5.5).
        phase = pausedFrom;
        if (phase === 'countdown') countdownMs = COUNTDOWN_MS;
        break;
      case 'end':
        phase = 'ended';
        log('Oyun yönetici tarafından bitirildi');
        break;
      case 'obstacle_add': {
        const type = OBSTACLE_TYPES.find((t) => t === a.type);
        if (!type || !int(a.segment, 0, Number.MAX_SAFE_INTEGER) || !int(a.lane, 0, MAX_LANE) || !num(a.pos, 0, 1)) {
          return reply('bad_args');
        }
        if ((a.segment as number) >= SEGMENTS) return reply('unknown_road');
        const id = nextObstacleId++;
        obstacles.set(id, { id, type, segment: a.segment as number, lane: a.lane as number, pos: a.pos as number });
        break;
      }
      case 'obstacle_remove':
        if (!int(a.id, 0, Number.MAX_SAFE_INTEGER)) return reply('bad_args');
        if (!obstacles.delete(a.id as number)) return reply('unknown_obstacle');
        break;
      case 'road_close': {
        if (!int(a.segment, 0, Number.MAX_SAFE_INTEGER)) return reply('bad_args');
        if ((a.segment as number) >= SEGMENTS) return reply('unknown_road');
        const id = nextObstacleId++;
        obstacles.set(id, { id, type: 'road_work', segment: a.segment as number, lane: 0, pos: 0.5 });
        break;
      }
      case 'obstacle_ahead': {
        const type = OBSTACLE_TYPES.find((t) => t === a.type);
        if (!type || !int(a.player, 0, PLAYER_COUNT - 1)) return reply('bad_args');
        const id = nextObstacleId++;
        const segment = Math.floor(noise() * SEGMENTS);
        obstacles.set(id, { id, type, segment, lane: 1, pos: 0.5 });
        break;
      }
      case 'quake':
        if (!num(a.mag, 0, 10) || !int(a.zone, -1, 8)) return reply('bad_args');
        if (!boardConnected) log('Tahta bağlı değil, deprem doğrudan oyunda başladı');
        startQuake(a.mag as number, a.zone as number, 'yönetici');
        break;
    }
    send({ t: 'state', state: state() });
    reply();
  }

  server.on('upgrade', (req, socket, head) => {
    if ((req.url ?? '').split('?')[0] !== path) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (link) => wss.emit('connection', link));
  });

  wss.on('connection', (link: WebSocket) => {
    // A second admin login replaces the first one (M2-1, #58).
    active?.close(4001, 'replaced by a new admin login');
    active = link;
    link.on('close', () => { if (active === link) active = undefined; });
    link.on('message', (data, binary) => {
      if (active !== link || !binary || !Buffer.isBuffer(data)) return;
      let message: unknown;
      try {
        message = decode(data);
      } catch {
        return;
      }
      if (typeof message !== 'object' || message === null) return;
      const m = message as { t?: unknown; id?: unknown; name?: unknown; args?: unknown };
      if (m.t === 'snapshot_get') return send(snapshot());
      if (m.t === 'params_get') return send({ t: 'params', list: [...params.values()] });
      if (m.t !== 'cmd' || !Number.isSafeInteger(m.id) || typeof m.name !== 'string') return;
      const args = typeof m.args === 'object' && m.args !== null && !Array.isArray(m.args)
        ? m.args as Record<string, unknown> : undefined;
      handle({ id: m.id as number, name: m.name, ...(args ? { args } : {}) });
    });
  });

  newCode();
  if (options.phase === 'playing') phase = 'playing';
  log('Kayıtlı oyun yüklendi');
  const timer = options.autoplay === false ? undefined : setInterval(() => step(STATE_MS), STATE_MS);

  return {
    commands,
    step,
    snapshot,
    param: (name: string) => params.get(name),
    get phase() { return phase; },
    /** Closes the admin connection without a close message, like a lost Wi-Fi link. */
    drop: () => active?.terminate(),
    setBoardConnected(connected: boolean) {
      boardConnected = connected;
      log(connected ? 'Tahta bağlandı' : 'Tahta bağlantısı koptu');
      send({ t: 'board', board: board() });
    },
    close() {
      clearInterval(timer);
      for (const link of wss.clients) link.terminate();
      wss.close();
    },
  };
}

export type FakeServer = ReturnType<typeof attachFakeServer>;

function int(v: unknown, min: number, max: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function num(v: unknown, min: number, max: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

function loss(upPct: number, downPct: number): number {
  return 100 * (1 - (1 - upPct / 100) * (1 - downPct / 100));
}
