# M2 Network and Synchronization

M2 connects the phones, the admin page and the LED board to the game server. It does not make game decisions. It takes messages from outside, checks them and gives them to M1. After each tick it takes the state from M1 and sends it to everybody. M2 also makes sure that nothing from outside can change the game state directly. For the admin, it measures the network and it can make the network worse on purpose for tests.

| Runs on | Technology | Requirements |
|---|---|---|
| Main computer, in the same server program as M1 | TypeScript on Node.js, WebSocket for phones and admin, TCP and UDP for the LED board, MessagePack binary messages, QR code for joining | R1 R9 R10 R11 |

## Inputs and outputs

| **Direction** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | Phone messages | M4, WebSocket | Hello with player key, name and game code, join with team, controls, “Find me”, ping replies |
| In | Admin messages | M5, WebSocket | Commands, parameter changes, requests for parameters and the game log |
| In | Board messages | M6, TCP and UDP | Earthquake events and status on TCP. Sensor samples and delay replies on UDP |
| In | State and metrics | M1 | Frozen game state and board state every tick, metrics twice per second |
| Out | To M1 | M1 | Checked controls, joins, “Find me”, admin commands, board events, lost and returning players, network metrics |
| Out | To phones | M4, WebSocket | Game state 30 times per second, join replies, ping, frame rate limit |
| Out | To admin | M5, WebSocket | State 10 times per second, metrics, replies, board data |
| Out | To board | M6, TCP and UDP | Config and vibrate commands on TCP. Board state and delay probes on UDP |

## Planned layout

```
src/
  http/        M2-1  pages, 3D models, city plan, QR and game code
  session/     M2-1  sessions and access
  codec/       M2-2  message coding and checks
  queue/       M2-2  input queue
  broadcast/   M2-3  state broadcaster
  metrics/     M2-3  ping and measurements
  board/       M2-4  board TCP channel and UDP stream
  netem/       M2-4  network emulator
test/
  fakes/       M2-3  fake M1 and bot phones
```

Each part can be built and tested alone with test data, as the module document describes.

## Run and test

Node.js 20 or newer.

```
npm install
npm test            # all tests
npm run demo        # start the server; join from a phone with the QR code
npm run demo:bots   # bot phones show the M2-1 demo points, then the demo ends
```

`npm run demo` prints the game code, the phone address and a QR code. The admin page is at
`http://localhost:8080/admin`. `PORT=9000 npm run demo` uses another port.

## M2-1: web server, join, sessions

| Part | Files |
|---|---|
| Six digit game code, new code on request | `src/http/gameCode.ts` |
| QR code with the address of the main computer and the game code | `src/http/joinInfo.ts` |
| Pages, 3D models (`/models/`), city plan (`/city_plan.json`), `/join`, `/qr.svg` | `src/http/httpServer.ts` |
| Placeholder phone and admin pages (the real ones come from M4 and M5) | `src/http/pages/` |
| Session record, player key, 8 places, one admin | `src/session/registry.ts` |
| WebSocket links: `/ws` for phones, `/ws/admin` for the admin | `src/session/wsServer.ts` |
| Starts everything | `src/server.ts` |

What M2-1 tells M1 (`PlayerEvents` in `src/session/types.ts`): a player joined with a team,
a player's link was lost, a lost player came back. M2-2's input queue will carry these to M1;
until then the tests and the demo use a small recording stand-in for M1.

Draft messages (until M2-2 writes the phone and admin messages into `contracts/`):

| Direction | Message |
|---|---|
| Phone → server | `{t:"hello", key, name, code}` — must be the first message |
| Phone → server | `{t:"join", team}` |
| Server → phone | `{t:"welcome", player, returning}` or `{t:"error", reason}` |

Close codes: 4001 another admin logged in, 4002 the same player opened on another page,
4003 the hello was rejected (`bad_code`, `full`, `bad_hello`).

Open points for the team:

- `contracts/` is not on `main` since the restart. `/city_plan.json` reads
  `contracts/city_plan.json` and gives 404 until the file is back.
- A player place stays with its key until M1 frees it (`registry.release`). The document
  does not say when a lobby place is freed; M1 decides.
- A key that already joined can come back after the admin makes a new game code.
- The session number that changes on every server start (document 6.5) belongs to the
  board link and is not part of M2-1.

## Team

Tuğberk Akbulut, Ayşe Poyraz, Hasan Hüseyin Özdemir, Umutcan Ocak

## Documents

- Modules and Requirements v2.1: [PDF](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.pdf) · [Markdown](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.md)
- Plan for the 4 December demo: issue #24
