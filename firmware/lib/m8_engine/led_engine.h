// M8 LED animation engine: the interface M7 calls (M7 proposal 3.2, M8 proposal 3.1).
// Portable C++: no Arduino, no Wi-Fi. Builds on the ESP32 and on a PC for tests.
#pragma once
#include <stdint.h>

namespace m8 {

constexpr int kLedCount = 344;     // 186 east-west + 150 north-south + 8 store LEDs
constexpr int kMaxPlayers = 8;
constexpr int kMaxObstacles = 60;

struct Rgb { uint8_t r, g, b; };

enum class Phase : uint8_t { Lobby = 0, Countdown = 1, Running = 2, Paused = 3, Finished = 4 };
enum class ObstacleType : uint8_t { HeavyTraffic = 1, RoadWork = 2, Accident = 3, Puddle = 4 };
enum class LinkStatus : uint8_t { Connected, Searching, Lost };

// Player flags (bit positions), same as the STATE message.
enum PlayerFlag : uint8_t { kActive = 1, kFallen = 2, kCarrying = 4, kBot = 8, kFindMe = 16 };

struct PlayerDot   { uint8_t id, team, tone, flags; float u, v, headingDeg, speedMps; };
struct DeliveryDot { uint8_t playerId; float u, v; uint8_t state; };
struct Obstacle    { uint8_t segment; ObstacleType type; uint8_t lane; };
struct Quake       { bool active; float u, v; uint8_t magnitude; uint16_t elapsedMs; };

struct BoardState {
  uint32_t seq = 0, serverMs = 0;
  Phase phase = Phase::Lobby;
  uint16_t timeLeftS = 0;
  uint8_t nPlayers = 0;    PlayerDot players[kMaxPlayers] = {};
  uint8_t nDeliveries = 0; DeliveryDot deliveries[kMaxPlayers] = {};
  uint8_t nObstacles = 0;  Obstacle obstacles[kMaxObstacles] = {};
  Quake quake = {};
};

struct BoardConfig {
  Rgb tones[kMaxPlayers] = {};   // team t, tone k -> tones[2 * t + k]
  float brightness = 0.6f;       // 0-1
  uint16_t maxMilliamps = 4000;  // current limit for the LED supply
};

void applyConfig(const BoardConfig& cfg);
void applyState(const BoardState& st);
void setLinkStatus(LinkStatus s);

// Pure: the same state, config and time always give the same frame.
void render(uint32_t nowMs, Rgb* out /* kLedCount */);

// Estimated LED current for a frame in mA (M8 proposal 6.1).
uint32_t estimateMilliamps(const Rgb* frame, int count);

}  // namespace m8
