import { decode } from '@msgpack/msgpack';

export type Phase = 'lobby' | 'countdown' | 'playing' | 'paused' | 'ended';

export interface AdminState {
  phase: Phase;
  timeLeftSeconds: number;
  gameCode: string;
  players: readonly { id: number; team: number; x: number; z: number; fallen: boolean }[];
  npcCars: readonly { id: number; x: number; z: number }[];
  obstacles: readonly { id: number; type: string; segment: number; lane: number; pos: number }[];
  deliveryPoints: readonly { id: number; x: number; z: number }[];
}

export interface Parameter {
  name: string;
  group: string;
  label?: string;
  integer?: boolean;
  value: number;
  min: number;
  max: number;
}

export interface MetricSample {
  name: string;
  time: number;
  value: number;
}

export interface BoardData {
  connected: boolean;
  samples: readonly MetricSample[];
  quake?: { mag: number; zone: number };
}

export interface LogEntry {
  time: number;
  message: string;
}

export interface ChangeMark {
  time: number;
  name: string;
}

export type AdminCommand =
  | { name: 'start' | 'pause' | 'resume' | 'end' | 'reset' | 'new_code' | 'param_reset' }
  | { name: 'quake'; args: { mag: number; zone: number } }
  | { name: 'param_set'; args: { name: string; value: number } }
  | { name: 'obstacle_add'; args: { type: string; segment: number; lane: number; pos: number } }
  | { name: 'obstacle_remove'; args: { id: number } }
  | { name: 'road_close'; args: { segment: number } }
  | { name: 'obstacle_ahead'; args: { player: number; type: string } };

export type CommandResult = { ok: true } | { ok: false; error: string };

export interface Snapshot {
  t: 'snapshot';
  state: AdminState;
  params: Parameter[];
  metrics: MetricSample[];
  board: BoardData;
  events: LogEntry[];
}

// The tags other than the M1 command/reply draft are placeholders until #35.
export type AdminMessage =
  | Snapshot
  | { t: 'state'; state: AdminState }
  | { t: 'params'; list: Parameter[] }
  | { t: 'param'; name: string; value: number }
  | { t: 'metrics'; samples: MetricSample[] }
  | { t: 'board'; board: BoardData }
  | { t: 'event'; entry: LogEntry }
  | ({ t: 'reply'; id: number } & CommandResult);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function point(value: unknown): boolean {
  return record(value) && finite(value.id) && finite(value.x) && finite(value.z);
}

function state(value: unknown): boolean {
  return record(value) && typeof value.phase === 'string' &&
    ['lobby', 'countdown', 'playing', 'paused', 'ended'].includes(value.phase) &&
    typeof value.gameCode === 'string' && finite(value.timeLeftSeconds) &&
    Array.isArray(value.players) && value.players.every((player) =>
      point(player) && finite(player.team) && typeof player.fallen === 'boolean') &&
    Array.isArray(value.npcCars) && value.npcCars.every(point) &&
    Array.isArray(value.deliveryPoints) && value.deliveryPoints.every(point) &&
    Array.isArray(value.obstacles) && value.obstacles.every((item) =>
      record(item) && finite(item.id) && typeof item.type === 'string' &&
      finite(item.segment) && finite(item.lane) && finite(item.pos));
}

function params(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => record(item) &&
    typeof item.name === 'string' && typeof item.group === 'string' &&
    (item.label === undefined || typeof item.label === 'string') &&
    (item.integer === undefined || typeof item.integer === 'boolean') && finite(item.value) && finite(item.min) && finite(item.max));
}

function samples(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => record(item) &&
    typeof item.name === 'string' && finite(item.time) && finite(item.value));
}

function board(value: unknown): boolean {
  return record(value) && typeof value.connected === 'boolean' && samples(value.samples) &&
    (value.quake === undefined || (record(value.quake) && finite(value.quake.mag) && finite(value.quake.zone)));
}

function event(value: unknown): boolean {
  return record(value) && finite(value.time) && Math.abs(value.time) <= 8.64e15 && typeof value.message === 'string';
}

function valid(message: Record<string, unknown>): boolean {
  switch (message.t) {
    case 'snapshot':
      return state(message.state) && params(message.params) && samples(message.metrics) && board(message.board) &&
        Array.isArray(message.events) && message.events.every(event);
    case 'state': return state(message.state);
    case 'params': return params(message.list);
    case 'param': return typeof message.name === 'string' && finite(message.value);
    case 'metrics': return samples(message.samples);
    case 'board': return board(message.board);
    case 'event': return event(message.entry);
    case 'reply':
      return Number.isSafeInteger(message.id) &&
        (message.ok === true || (message.ok === false && typeof message.error === 'string'));
    default: return false;
  }
}

export function decodeAdminMessage(data: unknown): AdminMessage | undefined {
  if (!(data instanceof ArrayBuffer)) return;
  try {
    const message = decode(data);
    if (record(message) && valid(message)) return message as unknown as AdminMessage;
  } catch {
    // A malformed frame should not interrupt the stream.
  }
}
