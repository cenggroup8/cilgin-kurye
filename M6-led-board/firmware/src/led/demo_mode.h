// Demo mode (M6-4): a whole game on the board with no server. It makes board
// states from a fixed script, so every phase, layer and effect is shown:
//
//   0–5 s    lobby, the 8 players wait at their stores
//   5–8 s    countdown 3, 2, 1
//   8–38 s   game: 8 dots drive the roads, 4 obstacle types, delivery points,
//            deliveries (flash), "Find me", a fall, an earthquake
//   38–42 s  pause
//   42–46 s  game again
//   46–51 s  end, team 2 wins
//   51–55 s  end, a draw between team 0 and team 3
//   55–59 s  "searching" view (no server)
//   then from the start.
//
// The states come 15 times per second, like the server, so the motion smoother
// works as in a real game.
#pragma once
#include <cstdint>

#include "../link/link_types.h"
#include "road_graph.h"

namespace led {

struct DemoFrame {
  bool newState = false;  // true when `state` is new this call
  boardlink::BoardState state;
  boardlink::LinkState link = boardlink::LinkState::Connected;
  uint8_t winners = 0;  // team bits for the end view
};

class DemoMode {
 public:
  static constexpr uint32_t kLoopMs = 59000;
  static constexpr uint32_t kStateMs = 66;  // 15 states per second

  explicit DemoMode(const RoadGraph& g = RoadGraph::board());

  void start(uint32_t nowMs);
  /** Call every frame. */
  DemoFrame step(uint32_t nowMs);

  /** Name of the part of the script at time t (ms from the start), for the serial log. */
  static const char* partName(uint32_t t);

 private:
  void makeState(uint32_t t, DemoFrame& out);

  const RoadGraph& g_;
  uint32_t startMs_ = 0;
  uint32_t lastStateMs_ = 0;
  bool started_ = false;
  uint32_t seq_ = 0;
  // Motorcycles of the demo game: a place on the road and a direction.
  RoadPos pos_[8];
  bool towardB_[8] = {};
  uint32_t simMs_ = 0;
};

}  // namespace led
