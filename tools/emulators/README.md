# M6 emulators (M6-5)

Two PC programs for the link between the server and the LED board
(doc v2.1 section 10.6, issue #56). With them the server side and the board side
can be built and tested without each other.

| Program | Takes the place of | What it does |
|---|---|---|
| **server emulator** (`npm run server`) | the server (M2) | Sends test board states, config, vibrate commands and delay probes. Delay, jitter and loss on the link can be changed. Shows the earthquake events, the seismic signal and the status of the board. |
| **board emulator** (`npm run board`) | the LED board (M6) | Sends Hello, delay replies, sensor samples, status and earthquake events (hand hits with the keys 1–9, and one event for each motor run). Draws the board as the LEDs would show the newest state. |

Both follow `contracts/board_protocol.md` and use the codec of M2-4
(`M2-network/src/board/`), so the bytes are the same as on the real server.
The server emulator runs the M2-4 board link itself (`BoardLink` and the network
emulator) and adds a test game on top of it.

## Run

Node.js 20 or newer.

```
cd M2-network && npm install        # once: the emulators use the M2-4 code
cd ../tools/emulators && npm install
npm run server                      # terminal 1
npm run board                       # terminal 2 (or the real board)
```

Options: `npm run server -- --port 47100 --seed 1 --hz 30`,
`npm run board -- --host 192.168.1.20 --port 47100 --broadcast --leds 5`.
Without `--broadcast` the board emulator sends its Hello straight to `--host`
(the backup address); with it, it searches with a UDP broadcast first, like the real board.

### Keys

Server emulator:

| Key | Does |
|---|---|
| `v` | vibrate all four motors (0.8, 1.5 s, 200 ms soft start) |
| `1`–`4` | vibrate one motor (NW, NE, SW, SE) |
| `+` / `-` | 50 ms more / less delay on the link (both directions) |
| `j`, `l` | jitter 0 / 20 / 50 ms, loss 0 / 10 / 30 / 50 % |
| `h` | board states per second: 10 / 20 / 30 |
| `b` | brightness 0.2 / 0.6 / 1 (sends the config) |
| `p`, `n` | pause / resume, next phase |
| `f`, `o`, `e` | "Find me" for player 0, a new obstacle, an earthquake from the server side |
| `x` | quit |

Board emulator: `1`–`9` hit zone 0–8 (zone = 3 × row + column, row 0 north),
`m` strength 3 / 6 / 9, `w` Wi-Fi off and on, `x` quit.

## The test game

`src/server/scenario.ts` makes board states from `contracts/city_plan.json`:
lobby → countdown → game → end, again and again. Eight riders drive on the roads
and turn at random at the crossings, each has a delivery point that flashes when
it is reached, obstacles of the four types appear and end, a rider falls now and
then. An earthquake event from the board starts the shock wave at the centre of
its zone, like M1 does (doc 5.5). Seeded: the same seed gives the same game.

## The board view

`src/board/view.ts` draws the five layers of doc 10.5 (roads, obstacles, delivery
points, motorcycles with a tail, effects), the game phases and the "searching"
look. It is the B plan view of #28: if the board is not ready, the LED part is
shown on the screen. The LED layout here is only for the screen (`--leds` LEDs on
each segment, none at the crossings, two store LEDs per corner); the real layout
comes from the LED map of M6-3; the default of 5 LEDs per segment and 2 per store
follows `M6-led-board/hardware/strip_layout.md`.

## Tests

```
npm test          # 32 tests, about 10 s
npm run typecheck
```

- all 10 contract vectors: both emulators decode them, and each encodes its own
  messages byte for byte (done criterion of #56)
- the two emulators on real sockets: connect, config, states, delay, sensor
  samples, status; a hand hit gives one event; a vibrate gives one motor event and
  a soft start; 50 % loss both ways; Wi-Fi off and on; server restart with a new
  session number
- the test game stays inside the ranges of `board_protocol.md`, riders stay on the roads
- the board view: LED counts, segment numbers, phases

## Notes

- M2-4 has its own small board emulator for its tests (`M2-network/test/fakes/boardEmu.ts`).
  Plan #28 says M2 uses the M6-5 one; the M2 tests can move to this one when it suits.
- The earthquake values of the board emulator follow M6-2 (#60): strength
  `5 + 2·log2(peak / standard peak)`, one event per hit, all shaking during a motor
  run is one `motor` event.
