# Çılgın Kurye — Module M6: Admin Panel and Monitoring

CSE 396 Module Documentation · Gebze Technical University · Group 8 (Board&Byte) · 6 November 2026

Team: Batuhan Yanar, Ayşe Poyraz, Berk Andaçgil

The PDF next to this file has the same text with all figures.

## 1. Purpose

M6 is the admin screen. On one page the admin starts and controls the game, changes all parameters during play, puts obstacles on a live map, starts earthquakes and watches the results as live graphs. Each change can be seen in three places: in the 3D city on the phones, on the LED board, and in the graphs on this page.

| Runs on | Browser on the main computer, or a laptop on the game Wi-Fi; the page comes from M2 |
|---|---|
| Technology | TypeScript web page built with Vite; uPlot for live graphs; HTML canvas for the live map; MessagePack |
| Requirements | R6 R7 R9 R10 R11 |

*Figure: Where M6 sits in the system. The admin page talks to M2 over one WebSocket.*

## 2. Requirements covered

| **ID** | **Requirement** | **What M6 does for it** |
|---|---|---|
| R6 | Obstacles | Map tools: obstacle brush, eraser, close a road, obstacle in front of a player, traffic density |
| R7 | Earthquake | Earthquake panel with strength and a live seismic graph |
| R9 | Live admin panel | Parameter forms for every group; graphs with a mark for every change |
| R10 | Network and measurement | Ping, loss and frame-rate graphs; network and board settings |
| R11 | Independent development | Works against a fake server with recorded data |

## 3. Inputs and outputs

| **Dir.** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | Game state | M1, through M2 | 10 times per second, for the live map |
| In | Metrics | M1, through M2 | Twice per second: scores, delivery times and distances, speeds, falls, traffic, ping, loss, frame rate, board delay |
| In | Parameters, replies | M1, through M2 | Every parameter with its value and limits; ok or error for each command |
| In | Board data | M7, through M2 | Sensor samples (100 per second), board status, earthquake events |
| Out | Commands | M2, then M1 | Parameter changes; start, pause, end, reset; obstacles; earthquake; new game code |
| Out | Files | Admin | Graph data as CSV; game log |

## 4. Main components

| **Component** | **What it does** | **Related modules** |
|---|---|---|
| Top bar | Phase, time left, game buttons, QR code and game code, board status light | M1, M2 |
| Parameter forms | One part for each group; “pending” until the reply; goes back to the old value on an error | M1–M4 |
| Live map | City from above with players, cars, obstacles, delivery points; map tools | M1, M4 |
| Graphs | Live graphs with change marks; CSV export | M1, M2, M7 |
| Earthquake panel and log | Start button, seismic graph; replies, events, errors | M1, M7 |

## 5. How it works

**The page.** The figure below shows the planned layout. The top bar shows the game phase, the time left, the buttons to start, pause and end the game, the game code and a small light for the board link (green when the board is connected). On the left are the parameter forms. In the centre is the live map: the city from above, drawn on a canvas 10 times per second with all motorcycles, NPC cars, obstacles and delivery points. On the right are the live graphs. At the bottom are the earthquake panel and the seismic graph.

*Figure: Planned layout of the admin page.*

**Parameters.** The parameters are in groups: game, obstacles, players, physics, earthquake, network (one set for each player) and board link. When the page opens, it asks M1 for all parameters with their limits and builds the forms from this list, so a new parameter needs no new page code. A slider sends its value when it stops moving for 300 ms, so one drag does not send 50 messages. Until the server answers, the value is marked “pending”. If the answer is “ok”, the mark goes away. If the answer is an error, the slider goes back to the old value and the log shows the reason.

**Cause and effect.** The main goal of the panel is to show the effect of a change. So every change puts a thin vertical line on all graphs, with the name of the parameter. For example, when the admin sets the traffic to 60 cars, the line appears and the graph of the mean NPC speed goes down right after it. At the same time the phones show more cars and the board shows more red. The graph data can be saved as a CSV file for the report.

**Map tools.** The admin can paint obstacles on the live map. A click is turned into a road segment, a lane and a position with the numbering of the city plan, and this goes to M1 as a command. There is a brush for each obstacle type, an eraser, a tool to close a whole road, a button to put an obstacle just in front of one player, and a traffic density control.

**Earthquake.** The start button sends a command to M1, and M1 asks the board to run its motors. The seismic graph shows the sensor signal of the board live, 100 samples per second. Each earthquake event puts a mark on the graph with its strength and zone. A hand hit on the board shows on the same graph, so the admin can compare the two.

## 6. Testing and demonstration

Tests run against a fake server that plays back a recorded game. We test every parameter form, every map tool, all graphs and the CSV export, a 5-minute load test, and that a second admin login is refused. In the demonstration the admin changes parameters, places obstacles and starts an earthquake, and the audience sees each change on the phones, on the board and in the graphs.
