# M6 LED Board and ESP32

M6 is the physical city board and the program on its ESP32. The board is 60 × 60 cm. Programmable addressable RGB LED strips lie in all roads and in the four stores, and there are 3D printed buildings, a motion sensor and four vibration motors. In the game the board is the only map, so it must be clear to read from every side of the table. One ESP32 runs one Arduino program with two parts. The link part gets the game state from the main computer over Wi-Fi, finds the strength and the place of a hit on the board, drives the vibration motors and reports the health of the board to the admin. The LED part turns the game state into light.

| Runs on | Technology | Requirements |
|---|---|---|
| ESP32 in the LED board, and the board itself for the hardware | C++ with Arduino for ESP32, TCP and UDP over Wi-Fi with MessagePack messages, programmable addressable RGB LED strips with an external power supply, a motion sensor with accelerometer and gyroscope, 4 vibration motors, 3D printing, a plywood base | R2 R5 R6 R7 R8 R10 R11 |

## Inputs and outputs

| **Direction** | **Data** | **From / to** | **Content** |
|---|---|---|---|
| In | Board state | M2, UDP | 10 to 30 per second: phase, players (team, colour, position, flags), delivery points, obstacles, earthquake |
| In | Config | M2, TCP | Player colours, brightness from 0.1 to 1, power limit |
| In | Vibrate | M2, TCP | Motors to use, strength from 0 to 1, duration |
| In | Delay probe | M2, UDP | A small message with the server time, answered at once |
| In | Sensor | Hardware | Motion data from the accelerometer and the gyroscope |
| In | Settings | USB cable | Wi-Fi name and password, backup server address, calibration values |
| In | City plan | Shared file | Road grid and store places, turned into the LED map when the code is built |
| Out | Light | LED strips | The colour of every LED, 60 frames per second |
| Out | Vibration | 4 motors | Motor power with a soft start and safety limits |
| Out | Earthquake event | M2, TCP, to M1 and M5 | Source (hand or motors), strength from 0 to 10, centre, zone from 0 to 8, confidence |
| Out | Sensor samples | M2, UDP, to M5 | Sensor data for the seismic graph, sent in small groups |
| Out | Status, delay reply | M2 | Status on TCP once per second: frame rate, Wi-Fi signal, power estimate, errors. Delay replies on UDP |

## Planned layout

```
firmware/   one Arduino program for the ESP32: link part (network, sensor, motors, status) and LED part (LED map, smoother, layers, output, demo mode)
hardware/   wiring, parts list and 3D printed parts of the board
```

The code is not written yet. Each part can be built and tested alone with test data, as the module
document describes.

## Team

Tuğberk Akbulut, Hasan Alperen Elmas, Hasan Hüseyin Özdemir, Muhib Taha Boy, Umutcan Ocak

## Documents

- Module document v2.0: [PDF](../docs/proposals/M6-led-board/v2.0/M6-proposal.pdf) · [Markdown](../docs/proposals/M6-led-board/v2.0/M6-proposal.md)
- All modules in one document: [PDF](../docs/proposals/modules-and-requirements/v2.0/Cilgin_Kurye_Modules_and_Requirements.pdf)
- Shared message formats and city plan: [`contracts/`](../contracts/)
