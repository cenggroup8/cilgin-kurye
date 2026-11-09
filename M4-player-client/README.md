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
src/        network client, 3D scene, controls, compass and HUD, prediction with the M3 physics code
assets/     low poly models shared with the board buildings
test/       tests against a fake server with recorded game states
```

The code is not written yet. Each part can be built and tested alone with test data, as the module
document describes.

## Team

Abdullatif Yılmaz, Batuhan Yanar, Ayşe Poyraz, Berk Andaçgil, Selim Barut

## Documents

- Module document v2.0: [PDF](../docs/proposals/M4-player-client/v2.0/M4-proposal.pdf) · [Markdown](../docs/proposals/M4-player-client/v2.0/M4-proposal.md)
- All modules in one document: [PDF](../docs/proposals/modules-and-requirements/v2.0/Cilgin_Kurye_Modules_and_Requirements.pdf)
- Shared message formats and city plan: [`contracts/`](../contracts/)
