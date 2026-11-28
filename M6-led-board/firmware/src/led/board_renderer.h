// Layers and effects (M6-4): turns the board state into one LED frame.
//
// Five layers, from the bottom to the top. A higher layer covers a lower one
// on the same LED; the short effects are added on top of everything.
//   1 roads              dim white, the stores in their team colour
//   2 obstacles          a red pattern for each of the three road obstacles, light blue for a puddle
//   3 delivery points    blink in the colour of their player, a short flash when delivered
//   4 motorcycles        dot and short tail in the player colour; white for 1 s on "Find me";
//                        two dots on one LED take turns
//   5 short effects      earthquake ring, delivery flash
//
// Phase views: lobby, countdown, game, pause, end (one or more winner teams), and the
// "searching" view while the board has no server.
//
//   renderer.onState(link.latestState(), millis());   // when the state version changes
//   renderer.draw(frame, millis(), link.config(), link.linkState());
//   outputStage.send(frame, millis());
#pragma once
#include <cstdint>

#include "../link/link_types.h"
#include "led_map.h"
#include "motion_smoother.h"

namespace led {

/** The 8 player colours used when the config has none (place = 2 × team + tone). */
extern const Rgb kDefaultTones[8];

/** Colour of a team store (contracts/README.md: blue, green, purple, yellow). */
extern const Rgb kTeamColours[4];

class BoardRenderer {
 public:
  explicit BoardRenderer(const RoadGraph& g = RoadGraph::board());

  /** A new board state. Starts the effects that begin with it. */
  void onState(const boardlink::BoardState& s, uint32_t nowMs);

  /**
   * Winner teams for the end view, as bits (bit i = team i). More than one bit is a draw.
   * The board state has no scores yet, so the server or the demo sets this; 0 shows all teams.
   */
  void setWinners(uint8_t teamMask) { winners_ = teamMask; }

  void draw(Frame& out, uint32_t nowMs, const boardlink::BoardConfig& cfg, boardlink::LinkState link);

  const MotionSmoother& smoother() const { return smoother_; }

 private:
  void drawRoads(Frame& f, Rgb road, float storeLevel);
  void drawObstacles(Frame& f, uint32_t now);
  void drawPoints(Frame& f, uint32_t now, const boardlink::BoardConfig& cfg);
  void drawBikes(Frame& f, uint32_t now, const boardlink::BoardConfig& cfg);
  void drawEffects(Frame& f, uint32_t now);
  void drawSearching(Frame& f, uint32_t now);
  void drawCountdown(Frame& f, uint32_t now);
  void drawEnd(Frame& f, uint32_t now);
  Rgb tone(const boardlink::BoardConfig& cfg, uint8_t team, uint8_t toneIdx) const;

  struct Flash {
    float u = 0, v = 0;
    uint32_t startMs = 0;
    Rgb colour;
    bool on = false;
  };

  const RoadGraph& g_;
  MotionSmoother smoother_;
  boardlink::BoardState state_;
  uint32_t stateMs_ = 0;
  bool haveState_ = false;
  uint32_t findMeStart_[kMaxPlayers] = {};
  bool findMeOn_[kMaxPlayers] = {};
  Flash flashes_[8];
  uint8_t winners_ = 0;
};

// Small colour helpers, also used by the demo and the tests.
Rgb scale(Rgb c, float k);
Rgb add(Rgb a, Rgb b);

}  // namespace led
