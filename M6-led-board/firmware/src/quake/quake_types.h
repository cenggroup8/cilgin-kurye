// M6-2 shared types. Plain C++17, no Arduino headers, so the PC tests use them too.
#pragma once
#include <cstdint>

namespace quake {

// One reading of the motion sensor. Acceleration in g, rotation in degrees per second.
// Axes in board coordinates after mounting (see QuakeCalibration): x east, y south, z up.
struct ImuSample {
  float ax = 0, ay = 0, az = 0;
  float gx = 0, gy = 0, gz = 0;
};

// The earthquake event ("Q" message of the board protocol).
enum class Source : uint8_t { Hit, Motor };

struct QuakeEvent {
  uint32_t id = 0;
  Source src = Source::Hit;
  float peakG = 0;  // strongest shaking in the hit window, g
  float mag = 0;    // strength 0 to 10
  float u = 0.5f;   // centre on the board, 0 to 1 (east)
  float v = 0.5f;   // centre on the board, 0 to 1 (south)
  uint8_t zone = 4; // 3 x 3 grid, row * 3 + column, 0 is the north-west corner
  float conf = 0;   // confidence 0 to 1
};

inline const char* sourceName(Source s) { return s == Source::Hit ? "hit" : "motor"; }

}  // namespace quake
