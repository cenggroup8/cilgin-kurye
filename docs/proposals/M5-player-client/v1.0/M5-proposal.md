# Çılgın Kurye — Module M5: Player Client and 3D City

CSE 396 Module Documentation · Gebze Technical University · Group 8 (Board&Byte) · 6 November 2026

Team: Abdullatif Yılmaz, Berk Andaçgil, Selim Barut

The PDF next to this file has the same text with all figures.

## 1. Purpose

M5 is the web page on each player's phone. The player scans a QR code or types the game code, chooses a team, and drives a motorcycle in a low-poly 3D city with buttons on the screen. There is no map on the phone. Only a compass arrow shows the direction of the delivery point or of the store. So players must look at the LED board on the table to find their way.

| Runs on | Player phone, only the web browser, nothing to install; the page comes from M2 |
|---|---|
| Technology | TypeScript web page built with Vite; Three.js for 3D; low-poly glTF models from one Blender file, shared with the board buildings; MessagePack; the M3 physics code for prediction |
| Requirements | R1 R2 R3 R5 R7 R8 R10 R11 |

*Figure: Where M5 sits in the system. Each phone talks to M2 over one WebSocket.*

## 2. Requirements covered

| **ID** | **Requirement** | **What M5 does for it** |
|---|---|---|
| R1, R2 | Game and deliveries | Join, team choice, timer, scores, package icon, “Deliver” button |
| R3 | Driving and controls | Gas, brake, left and right buttons |
| R5 | No map on the phone | Only a compass arrow; “Find me” button |
| R7 | Earthquake | The camera shakes |
| R8 | Same city as the board | The 3D city is built from the shared city plan and the same models |
| R10 | Network and measurement | Frame-rate limit from the admin; frame-rate report |
| R11 | Single authority | Own motorcycle is predicted at once and corrected by the server |

## 3. Inputs and outputs

| **Dir.** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | Game state | M2 | 30 times per second: players, NPC cars, obstacles, scores, compass target, “Find me” waiting time |
| In | Join reply, ping, net config | M2 | Player, team, colour tone; server time; frame-rate limit |
| In | Touch | Player | Buttons |
| Out | Controls | M2, then M1 | On every change and at least 10 times per second: throttle, brake, steer, deliver |
| Out | Join, “Find me” | M2, then M1 | Player key, name, game code, team; “Find me” request |
| Out | Ping reply | M2 | Phone time, frame rate, last state received |

## 4. Main components

| **Component** | **What it does** | **Related modules** |
|---|---|---|
| Screens and HUD | Join, lobby, countdown, game and end screens; timer, scores, compass | M1 |
| Controls | Turns button presses into the control record | M1, M2 |
| Network client | WebSocket link, MessagePack, reconnect with the saved player key | M2 |
| Prediction | Own motorcycle with the M3 code; correction on each state | M3 |
| 3D city and scene | City from the city plan; motorcycles, cars, obstacles, markers; camera | M4, M8 |

## 5. How it works

**The game screen.** The phone is held sideways. The 3D view fills the screen, and the camera follows the motorcycle from behind. At the top the player sees the time left and the score of each team. In the top corner there is the compass. The arrow points to the delivery point, or to the store when the player has no package. It never shows the distance or the roads. The buttons are large so that the thumbs can find them without looking: left and right on one side, gas and brake on the other side. The “Deliver” button is always active. If the server says no, a short message shows the reason, for example “too fast”. The “Find me” button asks the server to flash the player's LED on the board in white for 1 second. After a press, the button waits for the time that the server sends.

*Figure: Planned game screen on a phone held sideways.*

**Screens.** The page has five screens. On the join screen the player types a name and, if there was no QR code, the game code. In the lobby the player chooses one of the four teams and waits. A 3 second countdown starts the game. The game screen is shown above. At the end, the page shows the winner and the scores of all teams.

*Figure: The five screens of the phone page.*

**Smooth play on a real network.** The server sends a state 30 times per second, but Wi-Fi adds delay. If the phone waited for the server, the motorcycle would react late to a button. So the phone moves its own motorcycle at once with the M3 code, and corrects it when the real state arrives. For the other players and the NPC cars, the phone keeps the last few states and draws them 100 ms in the past. Then it can always move them smoothly between two real states, and they do not jump.

**The 3D city.** The city is built from the same city plan as the LED board: 6 roads in each direction, 60 road segments and 25 blocks. Tall buildings stand in the centre, houses and trees are outside, and the four team stores in the corners have the team colours. The models are low-poly and come from one Blender file. The board uses the same models for 3D printing (1 m in the game is 1 mm on the board), so a player can find the same building on the board and on the phone. Objects that repeat, like trees and houses, are drawn as instances, so a mid-range phone can draw at least 30 frames per second. During an earthquake the camera shakes, and the shaking is stronger near the centre of the earthquake.

## 6. Testing and demonstration

Tests run against a fake server. We test joining on Android and iPhone, every button, prediction with 150 ms delay and 10% loss, at least 30 frames per second on a mid-range phone, and reconnecting after a page reload. In the demonstration two phones drive in the 3D city. The players use the compass and the board to find the delivery point, and the admin changes the frame-rate limit of one phone.
