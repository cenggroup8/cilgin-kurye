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

The code is not written yet. Each part can be built and tested alone with test data, as the module
document describes.

## Team

Tuğberk Akbulut, Ayşe Poyraz, Hasan Hüseyin Özdemir, Umutcan Ocak

## Documents

- Modules and Requirements v2.1: [PDF](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.pdf) · [Markdown](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.md)
- Plan for the 4 December demo: issue #24
