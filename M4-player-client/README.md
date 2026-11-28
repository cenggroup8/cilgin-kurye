# M4 Player Client and 3D City

M4 is the web page on each player's phone. The player scans a QR code or types the game code, chooses a team, and drives a motorcycle in a low poly 3D city with buttons on the screen. There is no map on the phone. Only a compass arrow shows the direction of the delivery point or of the store. So players must look at the LED board on the table to find their way.

| Runs on | Technology | Requirements |
|---|---|---|
| Player phone, only the web browser, nothing to install. The page comes from M2 | TypeScript web page with Three.js for 3D, low poly models from one Blender file shared with the board buildings, MessagePack messages, the M3 physics code for prediction | R1 R2 R3 R5 R7 R8 R10 R11 |

## Inputs and outputs

| **Direction** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | Page, models, city plan | M2, HTTP | When the page loads: the program, the 3D models and the city plan |
| In | Game state | M2, from M1 | Players, NPC cars, obstacles, scores, compass target, “Find me” waiting time, number of the last control that the server used |
| In | Join reply, ping, net config | M2 | Player, team, colour, server time, frame rate limit |
| In | Touch | Player | Buttons |
| Out | Controls | M2, then M1 | Throttle, brake, steer, a control number |
| Out | Join, “Find me” | M2, then M1 | Player key, name, game code, team, “Find me” request |
| Out | Ping reply | M2 | Phone time, frame rate, last state received |

## Planned layout

```
src/
  net/         M4-3  network client
  screens/     M4-1  screens and HUD
  controls/    M4-2  buttons
  predict/     M4-4  prediction (uses the M3 physics code)
  scene/       M4-5  3D city and scene
assets/        M4-5  low poly models
test/
  fake-server/ M4-2  fake server and recorded game
```

The code is not written yet. Each part can be built and tested alone with test data, as the module
document describes.

## Run and test

Node.js 22.18 or newer (it runs TypeScript directly).

```
npm install
npm test            # tests of the network client (M4-3)
npm run typecheck
npm run dev         # phone page on port 5173; the game server is http://localhost:8080 (M2)
npm run dev -- --server http://localhost:5174   # another server, for example a fake server
npm run build       # the page in dist/, for M2 to serve
```

`npm run dev` prints the address for a phone on the same Wi-Fi. The page is built again on
every load. Everything the page does not have itself (the WebSocket `/ws`, `/city_plan.json`,
`/models/`, `/qr.svg`) goes on to the game server, so the phone talks to one address as in the
real game. The page is bundled with esbuild (K14 in #22).

## M4-3: network client

The only part of the page that talks to the server. Messages: [`contracts/messages.md`](../contracts/messages.md) (#90).

| Part | Files |
|---|---|
| Message types of the phone link and the data for the other parts (plan #26, 3.2): connection state, player info, game state, control record | `src/net/types.ts` |
| Every server message is checked before use; a broken one is dropped and never throws | `src/net/decode.ts` |
| Player key kept in the browser; control numbers that go on after a reload | `src/net/storage.ts` |
| WebSocket, hello and join, controls and "Find me", states, pong, frame rate limit, reconnect with the same key | `src/net/client.ts` |
| Page entry: a small network panel until the screens of M4-1 are in | `src/main.ts`, `index.html` |
| Development server and build | `tools/` |

How the other parts use it:

```ts
const client = new NetClient();                 // ws://<page host>/ws
client.subscribe((e) => { ... });               // connection, welcome, joined, refused, state, net, error
client.hello(name, code); client.join(team);    // M4-1 join and lobby screens
new Controls((c) => client.sendControl(c));     // M4-2; "Find me" → client.findMe()
client.toLocalSeq(lastControlSeq);              // M4-4: the server's number in M4-2's numbering
client.fpsLimit; client.setFps(fps);            // M4-5
```

Coming back: a reload sends the same key, so M2 gives the same player. A link that closes, or
that brings nothing for 3 s (a dead Wi-Fi often does not close the socket), is opened again with
waits of 0.5 s up to 5 s. A "Find me" pressed while the link is down is sent when it comes back.
If the server did not know the player any more (`welcome` with `returning: false`, for example
after a restart), the client sends its team again; a server that knows it sends `joined` by itself.
After `refused` (wrong code, full game) or `replaced` (the same player opened on another page)
the client stops.

Control numbers: M4-2 counts from 1 on every page load, but M1 only takes a number bigger than
the last one of the player (#91, open point 2). So the number on the wire is the local number
plus the highest number this key sent before, kept in the browser. `toLocalSeq()` turns the
server's number back, so the page itself only sees the numbers of M4-2.

## Team

Abdullatif Yılmaz, Batuhan Yanar, Ayşe Poyraz, Berk Andaçgil, Selim Barut

## Documents

- Modules and Requirements v2.1: [PDF](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.pdf) · [Markdown](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.md)
- Plan for the 4 December demo: issue #26
