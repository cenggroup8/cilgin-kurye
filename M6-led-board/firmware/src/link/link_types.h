// Data between the parts of the board program (M6 plan #28, section 3.2).
// The link part (M6-1, M6-2) and the LED part (M6-3, M6-4) meet only here:
// the LED part never touches network code, the link part never touches LED code.
// Field names follow contracts/board_protocol.md.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace boardlink {

// --- from the server to the LED part ------------------------------------------

/** Player flags in the board state (board_protocol.md, `p`). */
enum PlayerFlag : uint8_t {
  kInGame = 1,
  kFallen = 2,
  kPackage = 4,
  kBot = 8,
  kFindMe = 16,
};

struct Player {
  uint8_t id = 0;    // 0–7
  uint8_t team = 0;  // 0–3
  uint8_t tone = 0;  // 0 light, 1 dark
  uint8_t flags = 0;
  float u = 0, v = 0;  // 0–1, east and south
  float heading = 0;   // degrees, clockwise from north
  float speed = 0;     // m/s
};

struct DeliveryPoint {
  uint8_t owner = 0;  // player
  float u = 0, v = 0;
  uint8_t delivered = 0;  // 0 waiting (blinks), 1 delivered just now (flash)
};

struct Obstacle {
  uint8_t segment = 0;  // 0–59
  uint8_t type = 0;     // 1 heavy traffic, 2 road work, 3 accident, 4 water puddle
  uint8_t lane = 0;     // 0 the whole road
};

struct Earthquake {
  bool on = false;
  float u = 0, v = 0;
  float mag = 0;       // 0–10
  uint32_t ageMs = 0;  // since it started, for the shock wave
};

/** The newest full board state. The only thing the LED part reads from the link. */
struct BoardState {
  uint8_t phase = 0;  // 0 lobby, 1 countdown, 2 game, 3 pause, 4 end
  uint16_t timeLeft = 0;
  std::vector<Player> players;
  std::vector<DeliveryPoint> points;
  std::vector<Obstacle> obstacles;
  Earthquake quake;
  uint32_t seq = 0;         // order number of the message
  uint32_t receivedMs = 0;  // board time when it came
};

struct Rgb {
  uint8_t r = 0, g = 0, b = 0;
};

struct BoardConfig {
  std::string plan;           // city plan version of the server
  float bright = 0.5f;        // 0.1–1
  uint16_t maxMa = 8000;      // power limit of the LEDs in mA (start value of board.max_ma)
  Rgb tones[8];               // place = 2 × team + tone
  uint8_t tail = 2;           // length of the tail of a motorcycle dot, in LEDs
  float dpBlinkHz = 1.0f;     // how fast a delivery point blinks
};

/** Connected, or searching for the server. While searching the motors stop. */
enum class LinkState : uint8_t { Searching, Connecting, Connected };

struct VibrateCmd {
  uint8_t mask = 0;  // bit 0 zone 0, bit 1 zone 2, bit 2 zone 6, bit 3 zone 8
  float duty = 0;    // 0–1
  uint16_t ms = 0;
  uint16_t rampMs = 0;
};

// --- from the board parts to the server ----------------------------------------

/** Earthquake event from the hit detector (M6-2), same fields as `quake::QuakeEvent` in #60. */
struct QuakeOut {
  uint32_t id = 0;
  bool motor = false;  // false "hit", true "motor"
  float peakG = 0;
  float mag = 0;
  float u = 0.5f, v = 0.5f;
  uint8_t zone = 4;
  float conf = 0;
};

/** Status report (M6-3 fills it, the link sends it once per second). */
struct StatusOut {
  std::string fw;
  uint16_t fps = 0;
  int16_t rssi = 0;
  uint16_t maEst = 0;
  uint32_t heap = 0;
  std::vector<std::string> err;
};

}  // namespace boardlink
