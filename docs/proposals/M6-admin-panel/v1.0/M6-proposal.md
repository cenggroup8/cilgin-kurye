# Çılgın Kurye — Module M6: Admin Panel and Monitoring

CSE 396 Module Documentation · Gebze Technical University · Group 8 (Board&Byte) · 6 November 2026

Team: Batuhan Yanar, Ayşe Poyraz, Berk Andaçgil

The PDF next to this file has the same text with all figures.

## 1. Purpose

M6 is the admin screen. On one page the admin starts and controls the game, changes all parameters during play, puts obstacles on a live map, starts earthquakes and watches the results as live graphs. Each change can be seen in three places: in the 3D city on the phones, on the LED board, and in the graphs on this page.

| Runs on | Technology | Requirements |
|---|---|---|
| Browser on the main computer, or a laptop on the game Wi-Fi. The page comes from M2 | TypeScript web page, a light chart library for the live graphs, a 2D drawing of the city for the live map, MessagePack messages over one WebSocket | R6 R7 R9 R10 R11 |

The admin page talks only to M2, over one WebSocket. The figure shows what the page gets and what it sends.

## 2. Requirements covered

M6 takes part in five requirements. The last column says what will work when M6 is finished.

| **ID** | **Requirement** | **What M6 does for it** | **When M6 is done** |
|---|---|---|---|
| R6 | Obstacles | Map tools: a brush for each obstacle type, an eraser, a tool to close a road, an obstacle in front of a player, and the traffic density. Parameters for how often each obstacle type appears and how long it stays | The admin can put any obstacle on any road during the game and can change the rate and the duration of each type |
| R7 | Earthquake | An earthquake panel with a strength control and a live seismic graph of the board sensor | The admin can start an earthquake and compare it with a hand hit |
| R9 | Live admin panel | A form for every parameter group, and graphs with a mark for every change | Every change and its effect are seen on one page |
| R10 | Network and measurement | Ping, jitter, loss and frame rate graphs, and the network settings for each player and the board | The admin can make the network worse and measure the result |
| R11 | Engineering requirements | Works against a fake server with recorded data | M6 can be built before the server is ready |

## 3. Inputs and outputs

All data comes through M2. The game state for the map comes less often than to the phones, because the map needs fewer updates.

| **Direction** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | Game state | M1, through M2 | 10 times per second, for the live map |
| In | Metrics | M1, through M2 | Twice per second: scores, delivery times and distances, speeds, falls, traffic, ping, jitter, loss, frame rate, board delay. After a reconnect also the recent history |
| In | Parameters, replies | M1, through M2 | Every parameter with its value and limits, ok or error for each command |
| In | Board data | M7, through M2 | Sensor data, board status, earthquake events |
| Out | Commands | M2, then M1 | Parameter changes, start, pause, resume, end, reset, obstacles, earthquake, new game code |
| Out | Files | Admin | Graph data as CSV, game log |

## 4. Main components

The page is made of five parts. The communication manager is the only part that talks to M2.

| **Component** | **Takes** | **Gives** |
|---|---|---|
| Communication manager | Messages from M2, commands from the other parts | Decoded data for each part, reconnect and full update after a lost link |
| Parameter manager | Parameter list with limits, admin input | Forms built from the list, changes sent to M1 |
| Map manager | Game state, clicks on the map | The live map, and obstacle commands with road, lane and position |
| Graph engine | Metrics, board samples, change marks | Live graphs, the seismic graph, CSV files |
| Top bar and earthquake panel | Phase, time, board status, button presses | Game commands, earthquake command, the event log |

## 5. How it works

**The page:**

The figure below shows the planned layout. The top bar shows the game phase, the time left, the buttons to start, pause and end the game, the game code and a small light for the board link (green when the board is connected). On the left are the parameter forms. In the centre is the live map: the city from above, drawn again 10 times per second with all motorcycles, NPC cars, obstacles and delivery points. On the right are the live graphs. At the bottom are the earthquake panel and the seismic graph.

**Parameters:**

The parameters are in groups: game, obstacles, players, physics, earthquake, network (one set for each player) and board link. When the page opens, it asks M1 for all parameters with their limits and builds the forms from this list, so a new parameter needs no new page code. The obstacles group has two values for each of the four types: how often it appears by itself and how long it stays.

**Network settings:**

The network group has one row for each player and one for the board. In each row the admin sets an added delay, a jitter and a loss chance, and for a phone also a frame rate limit. M2 applies these values at once. The ping, jitter and loss graphs show the result next to the change mark.

**Cause and effect:**

The main goal of the panel is to show the effect of a change. So every change puts a thin vertical line on all graphs, with the name of the parameter. For example, when the admin sets more traffic, the line appears and the graph of the mean NPC speed goes down right after it. At the same time the phones show more cars and the board shows more red. The graph data can be saved as a CSV file for the report.

**Adding an obstacle:**

The admin first chooses a tool, for example the road work brush. Then the admin clicks on a road on the live map. The map manager finds the nearest road segment, the lane and the position on it with the numbering of the city plan. The communication manager sends an “add obstacle” command with the type, road, lane and position. M1 checks that the road exists. Then it adds the obstacle to the list. In the next tick the obstacle is in the game state, so the map, the phones and the board show it at the same time. It stays for the duration of its type, and then M1 removes it. The eraser removes it earlier with a “remove obstacle” command. “Close road” puts road work on a whole segment, and “in front of a player” puts the chosen obstacle a little ahead of that player's motorcycle.

**Earthquake:**

The start button sends a command to M1, and M1 asks the board to run its motors. The seismic graph shows the sensor signal of the board live. Each earthquake event puts a mark on the graph with its strength and zone. A hand hit on the board shows on the same graph, so the admin can compare the two.

**After a lost link:**

If the WebSocket breaks, the page shows a grey bar and tries to connect again. After the new connection, M2 sends the full parameter list, the current game state and the recent history of all graphs that M1 keeps. So the page fills the forms, the map and the graphs again and the admin can go on at once.

## 6. Testing

M6 is tested alone against a fake server that plays back a recorded game with its metrics, parameter list and board data. We check every parameter form with good and wrong values, every map tool, all graphs and the CSV export, a second admin login, and that after a lost link the forms, the map and the graphs are complete again.
