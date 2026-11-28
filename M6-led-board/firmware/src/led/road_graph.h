// Road graph of the board (M6-4): the 60 road segments and the intersections
// between them, built once from the LED map. The motion smoother uses it to
// move a dot along the roads and through the intersections, never across a
// block. Plain C++17, no Arduino headers, so the PC tests use the same code.
#pragma once
#include <array>
#include <cstdint>

#include "led_map.h"

namespace led {

constexpr uint8_t kMaxNodes = 64;
constexpr uint8_t kMaxNodeLinks = 4;
constexpr uint8_t kNoSegment = 0xFF;

/** A place on a road: segment and t (0 at node a, 1 at node b). */
struct RoadPos {
  uint8_t seg = kNoSegment;
  float t = 0;
  bool valid() const { return seg != kNoSegment; }
};

struct RoadNode {
  float u = 0, v = 0;
  uint8_t linkCount = 0;
  uint8_t links[kMaxNodeLinks] = {};  // segments that meet here
};

struct RoadSegment {
  uint8_t a = 0, b = 0;  // node ids
  float length = 0;      // in board units (u, v)
};

class RoadGraph {
 public:
  /** Built from the LED map (led_map_data.h). */
  static const RoadGraph& board();

  uint8_t nodeCount() const { return nodeCount_; }
  uint8_t segmentCount() const { return mapdata::kSegmentCount; }
  const RoadNode& node(uint8_t n) const { return nodes_[n]; }
  const RoadSegment& segment(uint8_t s) const { return segs_[s]; }

  /** Board place of a road place. */
  void place(RoadPos p, float& u, float& v) const;

  /** The road place nearest to a board place. */
  RoadPos nearest(float u, float v) const;

  /** Node at the end of segment s on the side `towardB`. */
  uint8_t endNode(uint8_t s, bool towardB) const { return towardB ? segs_[s].b : segs_[s].a; }

  /**
   * Shortest way on the roads from `from` to `to`, at most `maxSteps` pieces.
   * Each piece is a part of one segment from t0 to t1. Returns the piece count,
   * 0 when there is no way. `length` is the whole length.
   */
  struct Piece {
    uint8_t seg;
    float t0, t1;
  };
  uint8_t route(RoadPos from, RoadPos to, Piece* out, uint8_t maxSteps, float& length) const;

  /**
   * Moves `dist` along the road from p in the direction `towardB`. At an
   * intersection it takes the segment that goes most straight on (or turns
   * back at a dead end). p and towardB are updated.
   */
  void walk(RoadPos& p, bool& towardB, float dist) const;

 private:
  RoadGraph();
  uint8_t addNode(float u, float v);
  /** The segment leaving node n that is closest to the direction (du, dv), not `except`. */
  uint8_t straightest(uint8_t n, float du, float dv, uint8_t except) const;

  std::array<RoadNode, kMaxNodes> nodes_{};
  std::array<RoadSegment, mapdata::kSegmentCount> segs_{};
  uint8_t nodeCount_ = 0;
};

}  // namespace led
