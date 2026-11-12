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
src/        WebSocket server, board TCP and UDP link, message codec, checks, input queue, state broadcaster, network emulator, measurements
test/       tests with a fake M1, fake phones and the shared example messages
```

The code is not written yet. Each part can be built and tested alone with test data, as the module
document describes.

## Team

Tuğberk Akbulut, Ayşe Poyraz, Hasan Hüseyin Özdemir, Umutcan Ocak

## Documents

- Module document v2.0: [PDF](../docs/proposals/M2-network/v2.0/M2-proposal.pdf) · [Markdown](../docs/proposals/M2-network/v2.0/M2-proposal.md)
- All modules in one document: [PDF](../docs/proposals/modules-and-requirements/v2.0/Cilgin_Kurye_Modules_and_Requirements.pdf)
- Shared message formats and city plan: [`contracts/`](../contracts/)
