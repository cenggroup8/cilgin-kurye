#include "road_graph.h"

#include <cmath>

namespace led {

namespace {
constexpr float kInf = 1e9f;

float ledUf(uint16_t i) { return mapdata::kLeds[i].u / 65535.0f; }
float ledVf(uint16_t i) { return mapdata::kLeds[i].v / 65535.0f; }
float ledTf(uint16_t i) { return mapdata::kLeds[i].t / 255.0f; }
}  // namespace

const RoadGraph& RoadGraph::board() {
  static const RoadGraph g;
  return g;
}

RoadGraph::RoadGraph() {
  for (uint8_t s = 0; s < mapdata::kSegmentCount; s++) {
    const mapdata::SegmentRow& row = mapdata::kSegments[s];
    // The first and the last LED of the piece, by t.
    uint16_t lo = row.first, hi = row.first;
    for (uint8_t k = 0; k < row.count; k++) {
      const uint16_t i = row.first + k;
      if (ledTf(i) < ledTf(lo)) lo = i;
      if (ledTf(i) > ledTf(hi)) hi = i;
    }
    const float dt = ledTf(hi) - ledTf(lo);
    const float du = dt > 0 ? (ledUf(hi) - ledUf(lo)) / dt : 0;
    const float dv = dt > 0 ? (ledVf(hi) - ledVf(lo)) / dt : 0;
    // The LEDs stop before the intersection, so the nodes are found by going on to t = 0 and 1.
    const float ua = ledUf(lo) - du * ledTf(lo), va = ledVf(lo) - dv * ledTf(lo);
    const float ub = ua + du, vb = va + dv;
    RoadSegment& seg = segs_[s];
    seg.a = addNode(ua, va);
    seg.b = addNode(ub, vb);
    seg.length = std::hypot(du, dv);
    for (uint8_t n : {seg.a, seg.b}) {
      RoadNode& node = nodes_[n];
      if (node.linkCount < kMaxNodeLinks) node.links[node.linkCount++] = s;
    }
  }
}

uint8_t RoadGraph::addNode(float u, float v) {
  for (uint8_t n = 0; n < nodeCount_; n++) {
    if (std::fabs(nodes_[n].u - u) < 0.02f && std::fabs(nodes_[n].v - v) < 0.02f) return n;
  }
  if (nodeCount_ >= kMaxNodes) return kMaxNodes - 1;
  nodes_[nodeCount_].u = u;
  nodes_[nodeCount_].v = v;
  return nodeCount_++;
}

void RoadGraph::place(RoadPos p, float& u, float& v) const {
  if (!p.valid()) {
    u = v = -1;
    return;
  }
  const RoadNode& a = nodes_[segs_[p.seg].a];
  const RoadNode& b = nodes_[segs_[p.seg].b];
  u = a.u + (b.u - a.u) * p.t;
  v = a.v + (b.v - a.v) * p.t;
}

RoadPos RoadGraph::nearest(float u, float v) const {
  RoadPos best;
  float bestD = kInf;
  for (uint8_t s = 0; s < mapdata::kSegmentCount; s++) {
    const RoadNode& a = nodes_[segs_[s].a];
    const RoadNode& b = nodes_[segs_[s].b];
    const float du = b.u - a.u, dv = b.v - a.v;
    const float l2 = du * du + dv * dv;
    float t = l2 > 0 ? ((u - a.u) * du + (v - a.v) * dv) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const float eu = a.u + du * t - u, ev = a.v + dv * t - v;
    const float d = eu * eu + ev * ev;
    if (d < bestD) {
      bestD = d;
      best.seg = s;
      best.t = t;
    }
  }
  return best;
}

uint8_t RoadGraph::route(RoadPos from, RoadPos to, Piece* out, uint8_t maxSteps, float& length) const {
  length = 0;
  if (!from.valid() || !to.valid() || maxSteps == 0) return 0;
  if (from.seg == to.seg) {
    out[0] = {from.seg, from.t, to.t};
    length = std::fabs(to.t - from.t) * segs_[from.seg].length;
    return 1;
  }
  // Dijkstra over the nodes. The start has two ways out: to node a or to node b of its segment.
  float dist[kMaxNodes];
  uint8_t prevSeg[kMaxNodes];
  bool done[kMaxNodes] = {};
  for (uint8_t n = 0; n < nodeCount_; n++) {
    dist[n] = kInf;
    prevSeg[n] = kNoSegment;
  }
  const RoadSegment& fs = segs_[from.seg];
  dist[fs.a] = from.t * fs.length;
  dist[fs.b] = (1 - from.t) * fs.length;
  for (;;) {
    uint8_t n = kMaxNodes;
    for (uint8_t k = 0; k < nodeCount_; k++) {
      if (!done[k] && dist[k] < kInf && (n == kMaxNodes || dist[k] < dist[n])) n = k;
    }
    if (n == kMaxNodes) break;
    done[n] = true;
    const RoadNode& node = nodes_[n];
    for (uint8_t i = 0; i < node.linkCount; i++) {
      const uint8_t s = node.links[i];
      if (s == from.seg) continue;
      const uint8_t m = segs_[s].a == n ? segs_[s].b : segs_[s].a;
      if (dist[n] + segs_[s].length < dist[m]) {
        dist[m] = dist[n] + segs_[s].length;
        prevSeg[m] = s;
      }
    }
  }
  const RoadSegment& ts = segs_[to.seg];
  const float viaA = dist[ts.a] + to.t * ts.length;
  const float viaB = dist[ts.b] + (1 - to.t) * ts.length;
  if (viaA >= kInf && viaB >= kInf) return 0;
  const bool enterA = viaA <= viaB;
  length = enterA ? viaA : viaB;

  // Walk back from the entry node to the start segment, then write the pieces in order.
  Piece rev[kMaxNodes];
  uint8_t count = 0;
  rev[count++] = {to.seg, enterA ? 0.0f : 1.0f, to.t};
  uint8_t n = enterA ? ts.a : ts.b;
  while (prevSeg[n] != kNoSegment && count < kMaxNodes - 1) {
    const uint8_t s = prevSeg[n];
    const bool nIsB = segs_[s].b == n;
    rev[count++] = {s, nIsB ? 0.0f : 1.0f, nIsB ? 1.0f : 0.0f};
    n = nIsB ? segs_[s].a : segs_[s].b;
  }
  rev[count++] = {from.seg, from.t, n == fs.a ? 0.0f : 1.0f};
  if (count > maxSteps) return 0;
  for (uint8_t i = 0; i < count; i++) out[i] = rev[count - 1 - i];
  return count;
}

uint8_t RoadGraph::straightest(uint8_t n, float du, float dv, uint8_t except) const {
  const RoadNode& node = nodes_[n];
  uint8_t best = kNoSegment;
  float bestDot = -kInf;
  for (uint8_t i = 0; i < node.linkCount; i++) {
    const uint8_t s = node.links[i];
    if (s == except) continue;
    const RoadNode& other = nodes_[segs_[s].a == n ? segs_[s].b : segs_[s].a];
    const float ou = other.u - node.u, ov = other.v - node.v;
    const float l = std::hypot(ou, ov);
    const float dot = l > 0 ? (ou * du + ov * dv) / l : -1;
    if (dot > bestDot) {
      bestDot = dot;
      best = s;
    }
  }
  return best;
}

void RoadGraph::walk(RoadPos& p, bool& towardB, float dist) const {
  if (!p.valid()) return;
  for (int guard = 0; dist > 0 && guard < 16; guard++) {
    const RoadSegment& s = segs_[p.seg];
    const float left = (towardB ? 1 - p.t : p.t) * s.length;
    if (dist < left || s.length <= 0) {
      p.t += (towardB ? 1 : -1) * (s.length > 0 ? dist / s.length : 0);
      return;
    }
    dist -= left;
    const uint8_t n = towardB ? s.b : s.a;
    const RoadNode& from = nodes_[towardB ? s.a : s.b];
    const RoadNode& at = nodes_[n];
    uint8_t next = straightest(n, at.u - from.u, at.v - from.v, p.seg);
    if (next == kNoSegment) next = p.seg;  // dead end: turn back
    p.seg = next;
    towardB = segs_[next].a == n;
    p.t = towardB ? 0 : 1;
  }
}

}  // namespace led
