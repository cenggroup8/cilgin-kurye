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

## Team

Abdullatif Yılmaz, Batuhan Yanar, Ayşe Poyraz, Berk Andaçgil, Selim Barut

## Documents

- Modules and Requirements v2.1: [PDF](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.pdf) · [Markdown](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.md)
- Plan for the 4 December demo: issue #26
