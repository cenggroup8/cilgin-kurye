# M5 Admin Panel and Monitoring

M5 is the admin screen. On one page the admin starts and controls the game, changes all parameters during play, puts obstacles on a live map, starts earthquakes and watches the results as live graphs. Each change can be seen in three places: in the 3D city on the phones, on the LED board, and in the graphs on this page.

| Runs on | Technology | Requirements |
|---|---|---|
| Browser on the main computer, or a laptop on the game Wi-Fi. The page comes from M2 | TypeScript web page, a light chart library for the live graphs, a 2D drawing of the city for the live map, MessagePack messages over one WebSocket | R6 R7 R9 R10 R11 |

## Inputs and outputs

| **Direction** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | Game state | M1, through M2 | 10 times per second, for the live map |
| In | Metrics | M1, through M2 | Twice per second: scores, delivery times and distances, speeds, falls, traffic, ping, jitter, loss, frame rate, board delay. After a reconnect also the recent history |
| In | Parameters, replies | M1, through M2 | Every parameter with its value and limits, ok or error for each command |
| In | Board data | M6, through M2 | Sensor data, board status, earthquake events |
| Out | Commands | M2, then M1 | Parameter changes, start, pause, resume, end, reset, obstacles, earthquake, new game code |
| Out | Files | Admin | Graph data as CSV, game log |

## Planned layout

```
src/
  comm/      M5-1  communication manager
  topbar/    M5-1  top bar, earthquake panel, event log
  params/    M5-2  parameter manager
  map/       M5-3  map manager
  graphs/    M5-4  graph engine
test/
  fake-server/ M5-2  fake server and recorded game
```

Each part can be built and tested with test data, as the module document describes.

## Team

Batuhan Yanar, Ayşe Poyraz, Berk Andaçgil, Hasan Hüseyin Özdemir

## Documents

- Modules and Requirements v2.1: [PDF](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.pdf) · [Markdown](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.md)
- Plan for the 4 December demo: issue #27

## M5-1 demo

With Node 24 or later, run `npm ci` and `npm run demo` here. Open
`http://localhost:5175`, start the match and try pausing or starting an earthquake.
To simulate a drop, run `curl -X POST http://localhost:5175/demo/disconnect`.
The page reconnects and reloads the demo's parameters, map state and metrics.
Opening another tab replaces the first admin session.

`AdminConnection` connects to `/ws/admin`. Its `subscribe()` method delivers
snapshots and updates to the parameter, map and graph packages. Use `command()`
for a request and its reply. The connection emits one change mark for each
successful reply. See `src/comm/protocol.ts` for the MessagePack message types.
The command and reply fields follow #61. The snapshot and live stream fields
are provisional while #35 is open. The demo under `test/comm` is a fixture
for this package. The shared playback server belongs to M5-2 (#49).

Run `npm test`, `npm run typecheck` and `npm run build` to verify the package.
The build writes the admin page to `dist/`.

## M5-2: parameter manager and fake server

| Part | Files |
|---|---|
| Form layout and checks: groups in page order, one table per group for names like `obstacles.<type>.<field>`, a network table with one row per player and one for the board | `src/params/paramModel.ts` |
| Forms on the page: a wrong value is shown and not sent, the server's error is shown and the old value stays, a value changed elsewhere updates the form | `src/params/paramManager.ts`, `src/params/params.css` |
| Fake server: plays a recorded game with metrics, the parameter list and board data; answers every command like M1-5 (#61); can drop the connection | `test/fake-server/fakeServer.ts` |
| Recorded game (one seed, always the same game) | `test/fake-server/recording.ts` |

The forms are built only from the parameter list. A new parameter in
`M1-game-server/src/admin/param-list.ts` (M1-5) shows up in the fake server and in the
forms with no change here. The fake server reads that file, so both use the same names
and limits.

One command for every M5 package:

```
npm ci
npm run fake-server              # http://localhost:5175, the game is already running
npm run fake-server -- --lobby   # start in the lobby instead
curl -X POST http://localhost:5175/fake/disconnect   # drop the admin link
curl -X POST "http://localhost:5175/fake/board?on=0" # board link lost (on=1: back)
```

In a test, `attachFakeServer(server, { autoplay: false })` gives the same server with no
timers; `step(ms)` moves the game forward. The fake server sends the state 10 times and the
metrics twice per second, keeps two minutes of metric history for the snapshot after a
reconnect, and a delay or loss set in the network table shows up in the measured ping and loss.

It answers the admin messages of `contracts/messages.md` (#90): `snapshot_get` with one
`snapshot` (parameters, state, metric history, board data and log), `params_get` with `params`,
`log_get {since?}` with `log`, and every `cmd` with one `reply`. A message it cannot use gets
`error` with `bad_message`, `unknown_type` or `bad_field`, and the fake server keeps running.

The metric names (`score.<team>`, `traffic.*`, `speed.mean_mps`, `falls.total`,
`net.<p>.ping_ms|jitter_ms|loss_pct|fps`, `board.delay_ms`, `board.loss_pct`,
`board.accel_g`, `quake.mag`, `delivery.time_s`, `delivery.distance_m`) are provisional
until M1, M2 and M3 publish their metric lists with #35.
