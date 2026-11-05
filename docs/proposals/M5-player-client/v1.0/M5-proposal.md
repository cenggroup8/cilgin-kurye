# Çılgın Kurye — Module M5: Player Client and 3D City

CSE 396 Module Documentation · Gebze Technical University · Group 8 (Board&Byte) · 6 November 2026

Team: Abdullatif Yılmaz, Berk Andaçgil, Selim Barut

The PDF next to this file has the same text with all figures.

## 1. Purpose

M5 is the web page on each player's phone. The player scans a QR code or types the game code, chooses a team, and drives a motorcycle in a low poly 3D city with buttons on the screen. There is no map on the phone. Only a compass arrow shows the direction of the delivery point or of the store. So players must look at the LED board on the table to find their way.

| Runs on | Technology | Requirements |
|---|---|---|
| Player phone, only the web browser, nothing to install. The page comes from M2 | TypeScript web page with Three.js for 3D, low poly models from one Blender file shared with the board buildings, MessagePack messages, the M3 physics code for prediction | R1 R2 R3 R5 R7 R8 R10 R11 |

The phone talks only to M2. It gets the page once over HTTP and then keeps one WebSocket open. The figure shows the data in both directions.

## 2. Requirements covered

M5 takes part in eight requirements. The last column says what will work when M5 is finished.

| **ID** | **Requirement** | **What M5 does for it** | **When M5 is done** |
|---|---|---|---|
| R1 | Multiplayer game | Join, team choice, timer and the scores of all teams | A player joins and plays from the browser only |
| R2 | Delivery cycle | Package icon and the “Deliver” button with the reason when it is refused | The player always knows if a package is on board |
| R3 | Driving and controls | Gas, brake, left and right buttons | The motorcycle can be driven with two thumbs |
| R5 | No map on the phone | Only a compass arrow, and the “Find me” button with its waiting time | The player must use the LED board to find the way |
| R7 | Earthquake | The camera shakes, more near the centre | An earthquake is felt on every phone |
| R8 | Same city as the board | The 3D city is built from the shared city plan and the same models | The same building is found on the phone and on the board |
| R10 | Network and measurement | Frame rate limit from the admin, frame rate report | The admin sees how each phone runs |
| R11 | Engineering requirements | Own motorcycle is predicted at once and corrected by the server | Driving feels direct even on a slow network |

## 3. Inputs and outputs

The page sends its controls on every change and at least 10 times per second, and it gets a new state 30 times per second.

| **Direction** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | Page, models, city plan | M2, HTTP | When the page loads: the program, the 3D models and the city plan |
| In | Game state | M2, from M1 | Players, NPC cars, obstacles, scores, compass target, “Find me” waiting time, number of the last control that the server used |
| In | Join reply, ping, net config | M2 | Player, team, colour, server time, frame rate limit |
| In | Touch | Player | Buttons |
| Out | Controls | M2, then M1 | Throttle, brake, steer, a control number, and “Deliver” as an event |
| Out | Join, “Find me” | M2, then M1 | Player key, name, game code, team, “Find me” request |
| Out | Ping reply | M2 | Phone time, frame rate, last state received |

## 4. Main components

The page has five parts. The network client is the only part that talks to M2.

| **Component** | **Takes** | **Gives** |
|---|---|---|
| Screens and HUD | Game state, join reply | Join, lobby, countdown, game and end screens, timer, scores, compass |
| Controls | Touch on the buttons | The control record and the button events |
| Network client | Messages from M2, the saved player key | Decoded state for the other parts, reconnect after a lost link |
| Prediction | Own controls, server state | Own motorcycle at once, with a smooth correction |
| 3D city and scene | City plan, models, game state | The 3D picture with motorcycles, cars, obstacles and the camera |

## 5. How it works

**The game screen:**

The phone is held sideways. The 3D view fills the screen, and the camera follows the motorcycle from behind. At the top the player sees the time left and the score of each team. In the top corner there is the compass. The arrow points to the delivery point, or to the store when the player has no package. It never shows the distance or the roads. The buttons are large so that the thumbs can find them without looking: left and right on one side, gas and brake on the other side. The “Deliver” button is always active. If the server says no, a short message shows the reason, for example “too fast”. The “Find me” button asks the server to flash the player's LED on the board in white for 1 second. After a press, the button is grey and shows the waiting time that M1 puts into the game state.

**Screens:**

The page has five screens. On the join screen the player types a name and, if there was no QR code, the game code. In the lobby the player chooses one of the four teams and waits. A 3 second countdown starts the game. The game screen is shown above. At the end, the page shows the winner and the scores of all teams.

**Smooth play on a real network:**

The server sends a state 30 times per second, but Wi-Fi adds delay. If the phone waited for the server, the motorcycle would react late to a button. So the phone moves its own motorcycle at once with the M3 code, and corrects it when the real state arrives. For the other players and the NPC cars, the phone keeps the last few states and draws them a little in the past. Then it can always move them smoothly between two real states, and they do not jump.

**The 3D city:**

The city is built from the same city plan as the LED board: 6 roads in each direction, 60 road segments and 25 blocks. Tall buildings stand in the centre, houses and trees are outside, and the four team stores in the corners have the team colours. The models are low poly and come from one Blender file. The board uses the same models for 3D printing (1 m in the game is 1 mm on the board), so a player can find the same building on the board and on the phone. Objects that repeat, like trees and houses, are drawn as instances, so a mid range phone can draw a smooth picture. During an earthquake the camera shakes, and the shaking is stronger near the centre of the earthquake.

**Obstacles and falls in the 3D city:**

Obstacles from the game state are drawn on their road: cones and a barrier for road work, crashed cars for an accident, slow cars for heavy traffic and a wet patch for a water puddle. So a change by the admin is seen in the 3D city in the same tick as on the board. A fallen motorcycle lies on the road, and the page shows a penalty countdown until M1 lets it stand up again.

**Keeping the screen on:**

The page comes from the main computer over plain HTTP. Some browser functions that keep the screen on need a secure HTTPS page, so the screen may go dark during a game. We will test this on Android and iPhone and, if needed, ask players to turn off the screen timeout before the game.

## 6. Testing

M5 is tested alone against a fake server that sends recorded game states and answers the join and the controls. We check joining on Android and iPhone, every button and every screen, the compass target, the “Find me” waiting time, reconnecting after a page reload with the same player key, and the prediction with added delay and loss. We also check that a mid range phone draws the full city smoothly.
