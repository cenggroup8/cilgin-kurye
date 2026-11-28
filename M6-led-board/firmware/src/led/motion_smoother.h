// Motion smoother (M6-4): the board state comes 10 to 30 times per second, the
// LEDs are drawn 60 times per second. Between two states a motorcycle dot
// moves along the roads, through the intersections, from where it is drawn now
// to its new place, never straight across a block. When no new state comes,
// the dot goes on along its road with its last speed for a short time.
#pragma once
#include <cstdint>

#include "../link/link_types.h"
#include "road_graph.h"

namespace led {

constexpr uint8_t kMaxPlayers = 8;
constexpr uint8_t kMaxTail = 6;

struct SmoothDot {
  bool active = false;
  RoadPos pos;
  float u = 0, v = 0;
  /** LEDs the dot was on just before, newest first (the tail). */
  uint16_t trail[kMaxTail] = {};
  uint8_t trailCount = 0;
};

struct SmootherTuning {
  /** Longest time a dot goes on with its last speed when no state comes, ms. */
  uint32_t coastMaxMs = 1500;
  /** A way on the roads longer than this (board units) is a jump: the dot is put there at once. */
  float jumpLength = 0.45f;
  /** Board size in metres (contracts/city_plan.json `world.size_m`). */
  float worldSizeM = 500.0f;
};

class MotionSmoother {
 public:
  explicit MotionSmoother(const RoadGraph& g = RoadGraph::board(), SmootherTuning t = SmootherTuning{});

  /** Call once for every new board state. */
  void onState(const boardlink::BoardState& s, uint32_t nowMs);

  /** Call once per frame before drawing. */
  void update(uint32_t nowMs);

  const SmoothDot& dot(uint8_t player) const { return dots_[player]; }

  /** Mean time between two states, ms (for the tests and the status). */
  float stateIntervalMs() const { return intervalMs_; }

  void reset();

 private:
  struct Track {
    RoadGraph::Piece pieces[12];
    uint8_t pieceCount = 0;
    float length = 0;
    uint32_t startMs = 0;
    float speedUv = 0;  // board units per ms, for coasting
    bool towardB = true;
    RoadPos end;
  };

  RoadPos along(const Track& tr, float d) const;
  void pushTrail(SmoothDot& d);

  const RoadGraph& g_;
  SmootherTuning tune_;
  SmoothDot dots_[kMaxPlayers];
  Track tracks_[kMaxPlayers];
  float intervalMs_ = 66.0f;
  uint32_t lastStateMs_ = 0;
  bool haveState_ = false;
};

}  // namespace led
