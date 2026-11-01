# Board firmware (M7 + M8)

ESP32-WROOM-32E, Arduino-ESP32 3.x on PlatformIO.

| Path | Module | Content |
| --- | --- | --- |
| `src/main.cpp` | M7 | Start-up, FreeRTOS tasks |
| `src/m7/` | M7 | Wi-Fi, UDP board protocol, IMU and hit detection, vibration motors |
| `lib/m8_engine/` | M8 | LED animation engine, portable C++ (no Arduino code) |
| `test/` | M7, M8 | Unit tests that run on the PC |

Core 0 runs M7 tasks; core 1 runs only the M8 render task.

```bash
pio run -e esp32dev            # build
pio run -e esp32dev -t upload  # flash over USB
pio device monitor             # serial console
pio test -e native             # PC unit tests
```

Wi-Fi name and password go in `include/secrets.h` (ignored by git), never in the code.

Proposed pins (M7 proposal 3.3): IMU I²C on GPIO 21/22 (interrupt 19), motors on 25/26/27/33,
LED data on 4/16/17/18/23, status LED on 2, demo button on 0.
