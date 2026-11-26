import { encode } from '@msgpack/msgpack';
import { decodeAdminMessage, type AdminCommand, type AdminMessage, type ChangeMark, type CommandResult } from './protocol.ts';

export type ConnectionStatus = 'connecting' | 'reconnecting' | 'connected' | 'replaced';

export type AdminUpdate =
  | { t: 'connection'; status: ConnectionStatus }
  | { t: 'mark'; mark: ChangeMark }
  | Exclude<AdminMessage, { t: 'reply' }>;

interface Pending {
  resolve: (result: CommandResult) => void;
  name: string;
  timer: ReturnType<typeof setTimeout>;
}

export class AdminConnection {
  private readonly url: string;
  private readonly subscribers = new Set<(event: AdminUpdate) => void>();
  private readonly pending = new Map<number, Pending>();
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private syncDeadline?: ReturnType<typeof setTimeout>;
  private status: ConnectionStatus = 'connecting';
  private nextId = 1;
  private retryDelay = 750;

  constructor(url: string) {
    this.url = url;
  }

  subscribe(listener: (event: AdminUpdate) => void): () => void {
    this.subscribers.add(listener);
    listener({ t: 'connection', status: this.status });
    return () => this.subscribers.delete(listener);
  }

  start(): void {
    if (this.socket || this.retry !== undefined || this.status === 'replaced') return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    this.syncDeadline = setTimeout(() => socket.close(), 5000);
    socket.addEventListener('open', () => {
      if (socket === this.socket) socket.send(encode({ t: 'snapshot_get' }));
    });
    socket.addEventListener('message', ({ data }) => {
      if (socket !== this.socket) return;
      const message = decodeAdminMessage(data);
      if (!message) return;
      if (message.t === 'snapshot') {
        clearTimeout(this.syncDeadline);
        this.retryDelay = 750;
        this.emit(message);
        this.setStatus('connected');
      } else if (this.status === 'connected') {
        if (message.t === 'reply') this.reply(message);
        else this.emit(message);
      }
    });
    socket.addEventListener('close', ({ code }) => {
      if (socket !== this.socket) return;
      this.socket = undefined;
      clearTimeout(this.syncDeadline);
      this.failPending('disconnected');
      // M2-1 (#58) closes the old tab with this code when a second admin joins.
      if (code === 4001) {
        this.setStatus('replaced');
        return;
      }
      this.setStatus('reconnecting');
      this.retry = setTimeout(() => {
        this.retry = undefined;
        this.start();
      }, this.retryDelay);
      this.retryDelay = Math.min(5000, this.retryDelay * 2);
    });
  }

  stop(): void {
    clearTimeout(this.retry);
    clearTimeout(this.syncDeadline);
    this.retry = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.failPending('disconnected');
    this.setStatus('connecting');
  }

  command(command: AdminCommand): Promise<CommandResult> {
    const socket = this.socket;
    if (this.status !== 'connected' || socket?.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ ok: false, error: 'not_connected' });
    }
    const id = this.nextId++;
    const name = command.name === 'param_set' ? command.args.name : command.name;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'timeout' });
      }, 5000);
      this.pending.set(id, { resolve, name, timer });
      try {
        socket.send(encode({ t: 'cmd', id, ...command }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ ok: false, error: 'disconnected' });
      }
    });
  }

  private reply({ id, ...result }: Extract<AdminMessage, { t: 'reply' }>): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (result.ok) {
      pending.resolve({ ok: true });
      this.emit({ t: 'mark', mark: { name: pending.name, time: Date.now() } });
    } else {
      pending.resolve({ ok: false, error: result.error });
    }
  }

  private failPending(error: string): void {
    for (const { resolve, timer } of this.pending.values()) {
      clearTimeout(timer);
      resolve({ ok: false, error });
    }
    this.pending.clear();
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit({ t: 'connection', status });
  }

  private emit(event: AdminUpdate): void {
    for (const listener of this.subscribers) listener(event);
  }
}
