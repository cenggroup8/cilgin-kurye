import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GameCode } from "./http/gameCode.js";
import { createHttpServer, type StaticPaths } from "./http/httpServer.js";
import { joinUrl, lanAddress } from "./http/joinInfo.js";
import { Codec } from "./codec/codec.js";
import { SessionRegistry } from "./session/registry.js";
import type { PlayerEvents, Session } from "./session/types.js";
import { attachWebSockets } from "./session/wsServer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

export const DEFAULT_PATHS: StaticPaths = {
  pagesDir: join(HERE, "http", "pages"),
  modelsDir: join(REPO, "M4-player-client", "assets"),
  cityPlanFile: join(REPO, "contracts", "city_plan.json"),
};

export interface M2Options {
  port?: number;
  /** Address that goes into the QR code. Default: the LAN address. */
  publicHost?: string;
  paths?: Partial<StaticPaths>;
  /** Where joins, lost and returning players go. M1 (or a fake) gives this. */
  events: PlayerEvents;
  /** Other messages after the hello. M2-2 plugs in here. */
  onMessage?: (session: Session, msg: unknown, bytes: number) => void;
  /** M2-2 limits on the raw bytes of every message (`inbound.admit`). */
  admit?: (session: Session, bytes: number) => boolean;
  /** Also take JSON text from a link (readable form, development only). Default: `M2_READABLE=1`. */
  readable?: boolean;
}

export interface M2Server {
  port: number;
  gameCode: GameCode;
  registry: SessionRegistry;
  joinUrl(): string;
  /** The admin asked for a new game code (M1 passes the command on). */
  newGameCode(): string;
  send(connId: number, msg: unknown): void;
  /** Already encoded bytes (M2-3 encodes one state once for all phones). */
  sendRaw(connId: number, bytes: Uint8Array): void;
  /** Bytes queued on a link and not sent yet. */
  buffered(connId: number): number;
  close(): Promise<void>;
}

/** Starts the web server and the session part of M2 (M2-1). */
export async function startM2Server(opts: M2Options): Promise<M2Server> {
  const gameCode = new GameCode();
  const registry = new SessionRegistry(gameCode, opts.events);
  const publicHost = opts.publicHost ?? lanAddress();
  let port = opts.port ?? 8080;

  const http = createHttpServer({
    paths: { ...DEFAULT_PATHS, ...opts.paths },
    gameCode,
    publicHost,
    publicPort: () => port,
  });
  const codec = new Codec({ readable: opts.readable ?? process.env.M2_READABLE === "1" });
  const ws = attachWebSockets(http, { registry, onMessage: opts.onMessage, admit: opts.admit, codec });

  await new Promise<void>((ok, fail) => {
    http.once("error", fail);
    http.listen(port, "0.0.0.0", () => ok());
  });
  port = (http.address() as AddressInfo).port;

  return {
    port,
    gameCode,
    registry,
    joinUrl: () => joinUrl(publicHost, port, gameCode.value),
    newGameCode: () => gameCode.renew(),
    send: ws.send,
    sendRaw: ws.sendRaw,
    buffered: ws.buffered,
    close: () =>
      new Promise((ok) => {
        ws.close();
        http.close(() => ok());
        http.closeAllConnections();
      }),
  };
}
