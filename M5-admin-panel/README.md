# M5 Admin Panel and Monitoring

M5 is the admin screen. On one page the admin starts and controls the game, changes all parameters during play, puts obstacles on a live map, starts earthquakes and watches the results as live graphs. Each change can be seen in three places: in the 3D city on the phones, on the LED board, and in the graphs on this page.

| Runs on | Technology | Requirements |
|---|---|---|
| Browser on the main computer, or a laptop on the game Wi-Fi. The page comes from M2 | TypeScript web page, a light chart library for the live graphs, a 2D drawing of the city for the live map, MessagePack messages over one WebSocket | R6 R7 R9 R10 R11 |

## Inputs and outputs

| **Direction** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | Game state | M1, through M2 | 10 times per second, for the live map |
| In | Metrics | M1, through M2 | Twice per second: scores, delivery times and distances, speeds, falls, traffic, ping, jitter, loss, frame rate, board delay. After a reconnect also the recent history |
| In | Parameters, replies | M1, through M2 | Every parameter with its value and limits, ok or error for each command |
| In | Board data | M6, through M2 | Sensor data, board status, earthquake events |
| Out | Commands | M2, then M1 | Parameter changes, start, pause, resume, end, reset, obstacles, earthquake, new game code |
| Out | Files | Admin | Graph data as CSV, game log |

## Planned layout

```
src/
  comm/      M5-1  communication manager
  topbar/    M5-1  top bar, earthquake panel, event log
  params/    M5-2  parameter manager
  map/       M5-3  map manager
  graphs/    M5-4  graph engine
test/
  fake-server/ M5-2  fake server and recorded game
```

The code is not written yet. Each part can be built and tested alone with test data, as the module
document describes.

## Team

Batuhan Yanar, Ayşe Poyraz, Berk Andaçgil, Hasan Hüseyin Özdemir

## Documents

- Modules and Requirements v2.1: [PDF](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.pdf) · [Markdown](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.md)
- Plan for the 4 December demo: issue #27
