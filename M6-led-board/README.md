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
firmware/
  src/
    link/     M6-1  Wi-Fi, TCP and UDP, message codec, state hand over
    quake/    M6-2  hit detector, motor controller
    led/      M6-3  LED map, post processing and output
              M6-4  motion smoother, layers and effects, demo mode
    sys/      M6-3  status report, settings
  test/             tests that run on the PC (codec, smoother, detector)
hardware/     M6-5  wiring, pin table, parts list, print files

Shared scripts in ../tools/ (planned):
  server_emu    M6-5  stands in for the server
  board_emu     M6-5  stands in for the board (M2 uses it too)
  make_led_map  M6-3  builds the LED map from the city plan
```

Each part can be built and tested alone with test data, as the module document describes.

## M6-2 Hit detector and motor controller

Code in `firmware/src/quake/`. It is plain C++17 with no Arduino headers (except
`shield_pins_arduino.h` and `i2c_arduino.h`, built only for the board), so the same files run in
the ESP32 program and in the PC tests.

| File | What it does |
|---|---|
| `fixed_rate.h` | Reads the sensor at a fixed rate (200 Hz) without waiting in the main loop |
| `hit_detector.*` | Filter, room noise threshold, hit window, strength 0–10, zone 0–8, confidence, wait after a hit, one event for motor shaking |
| `motor_controller.*` | Four motors with a soft start, a strength and time limit, and a stop at once when the link is lost |
| `motor_shield.*` | Output to the bought motor shield (2 × L293D + 74HC595): one PWM speed pin per motor, the direction byte `0x27` once at start. Pins as in `hardware/pins_and_power.md` |
| `shield_pins_arduino.h` | The shield's pin calls on the ESP32 (`pinMode`, `digitalWrite`, `ledcAttach`, `ledcWrite`); the PC tests use a fake |
| `mpu6050.*` | Motion sensor driver (MPU-6050 on I2C, 0x68): 200 samples per second, ±16 g, ±500 °/s, its own filter at about 94 Hz; tries again about once a second when the sensor does not answer |
| `i2c_arduino.h` | The sensor's I2C bus on the ESP32 (Wire, GPIO21/22, 400 kHz, short timeout); the PC tests use a fake |
| `sample_batcher.h` | Sensor samples for the seismic graph: 100 per second in groups of 10, short peaks are kept |
| `calibration.*` | Calibration values and their keys in the board settings (flash, changed over USB) |
| `quake_unit.h` | Puts the parts together for the main loop. M6-1 gives the link state and sends the events and samples |

How a hit is found:

1. A slow average of each axis is taken away. Gravity and slow tilting go, only the shaking is left.
   The average follows only quiet samples, never a hit or its ringing.
2. For the first 3 s after power on the detector only learns the room noise. After that it keeps
   learning it slowly. The threshold is 6 × the noise, never below 0.15 g.
3. When the shaking passes the threshold, an 80 ms window starts.
4. Strength: `5 + 2 · log2(peak / standard peak)`, kept between 0 and 10. The standard hit
   (2 g by default) is 5, and each doubling adds 2, so strong hits grow slowly.
5. Zone: the first sideways push of the board (accelerometer) and its tilt (gyroscope) give the side
   of the hit. The share of the sideways push gives the distance from the centre. Together they give
   a centre (u, v) on the board and one of the 9 zones (row × 3 + column, 0 is north-west).
   The confidence is high when the push and the tilt agree and the hit is clearly above the threshold.
6. After a hit the detector waits 400 ms, so one hit is one event.
7. While the motors run, and for 0.5 s after they stop, the room noise is not learned and the
   whole shaking gives only one event with the source `motor`.

Motors: bit i of the vibrate mask is motor i, under zone 0, 2, 6 and 8 (bits 0 to 3).
Limits by default: strength at most 0.8, time at most 5 s, soft start at least 150 ms.
The shield runs the speed pins with 1 kHz, 8-bit PWM (strength 1 = 255). `begin()` is the first
call in `setup()`: until then the speed pins float, and the L293D may read that as "on".

### Tests on the PC

```bash
cd M6-led-board/firmware/test
make test
```

The tests use a simulated board (`sim_board.h`) with room noise, slow tilting, normal play bumps,
hand hits at any place and motor shaking. They check:

- 10 minutes of a quiet table and 10 minutes of a noisy table with normal play give no event,
  and the threshold goes up on the noisy table.
- 40 hits on each of the 9 zones: every hit is found, each gives exactly one event, and the zone is
  right or a neighbour. The test prints the table of real zone against found zone.
- The strength scale, two hits close together, a hit in the middle and the mounting flags.
- Motor shaking gives one `motor` event, no learning of the noise and no second earthquake.
- Soft start, limits, the motor mask and the stop on a lost link.
- The graph groups, the fixed rate and the main loop with all parts together.

The simulated hit follows the same idea as the detector, with random errors in the direction,
the distance and the strength on top. So the tests show that the code does what the design says.
The real values (standard peak, edge share, mounting flags) must be set with real hits on the board.

Open points:

- The sensor is not chosen yet. The driver only needs to fill `ImuSample` (g and degrees per second).
- The pins and the PWM of the motors come with the wiring (M6-5), through `MotorOutput`.
- The ESP32 build needs C++17 (Arduino ESP32 core 3.x).

## M6-3: LED map, post processing and output, status and settings

| Part | Files |
|---|---|
| LED map script: from `contracts/city_plan.json` and `hardware/strip_layout.json` (M6-5) to the table that goes into the build; checks that every road and store has its LEDs, the chains have no gap and the LEDs follow the wiring direction | `../tools/make_led_map/make-led-map.mjs` → `firmware/src/led/led_map_data.h` |
| LED map for the drawing code (M6-4): the LED at a place on a road, the road LED nearest to a board place, the store LEDs | `firmware/src/led/led_map.h` |
| Test patterns: pieces one by one with the data end in red, a chase along each chain, one road from node a (red) to node b (blue), all white | `firmware/src/led/test_pattern.h` |
| Post processing: colour correction for the eye (gamma 2.2), brightness of the config, power limit (the whole frame is dimmed by one factor when it would need more than `max_ma`) | `firmware/src/led/post_process.h` |
| Output stage: mixed frame of M6-4 → post processing → the two chains; frame report (`fps`, `ma_est`, `err`) for the status message | `firmware/src/led/output_stage.h`, `firmware/src/sys/frame_stats.h` |
| Settings in flash (Wi-Fi, backup server, M6-2 calibration values) and the USB console | `firmware/src/sys/settings.h`, `firmware/src/sys/settings_nvs.h` |
| Where the colours leave the program; the driver is not written yet (see below) | `firmware/src/led/strip_output.h` |

```
node tools/make_led_map/make-led-map.mjs           # from the repository root: writes the header
node tools/make_led_map/make-led-map.mjs --check   # fails if the header is older than its inputs
node --test tools/make_led_map/make-led-map.test.mjs
cd firmware/test/led && make test                  # PC tests (g++ or clang, C++17)
```

The USB commands (115200 baud): `show`, `set wifi_ssid <name>`, `set wifi_pass <password>`,
`set backup_host <address>`, `set cal.<name> <number>`, `save`, `reset`, `restart`,
`test <off|pieces|chase|segment|white> [segment]`. A changed Wi-Fi name is used after
`save` and `restart`, with no new build.

In the main loop (once M6-1, #64, is in): step 4 ends with `outputStage.send(frame, millis())`,
the config goes in with `outputStage.setConfig(cfg.bright, cfg.maxMa)` when its version
changes, and step 5 fills `StatusOut` with `outputStage.fps()`, `outputStage.maEst()` and
`outputStage.errors(millis())`.

**Not done yet: the strip driver.** The project documents do not name an LED library. The
driver must send chain A on GPIO16 and chain B on GPIO17 at the same time (two RMT channels,
`hardware/pins_and_power.md`). It goes behind `StripOutput` once the team chooses the library.

## Team

Tuğberk Akbulut, Hasan Alperen Elmas, Hasan Hüseyin Özdemir, Muhib Taha Boy, Umutcan Ocak

## Documents

- Modules and Requirements v2.1: [PDF](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.pdf) · [Markdown](../docs/modules-and-requirements/Cilgin_Kurye_Modules_and_Requirements.md)
- Plan for the 4 December demo: issue #28
