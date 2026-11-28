#include "motion_smoother.h"

#include <cmath>

namespace led {

MotionSmoother::MotionSmoother(const RoadGraph& g, SmootherTuning t) : g_(g), tune_(t) {}

void MotionSmoother::reset() {
  for (auto& d : dots_) d = SmoothDot{};
  for (auto& t : tracks_) t = Track{};
  haveState_ = false;
}

void MotionSmoother::onState(const boardlink::BoardState& s, uint32_t nowMs) {
  // Where every dot is drawn right now: the new way starts there, so nothing jumps.
  update(nowMs);
  if (haveState_) {
    const float dt = static_cast<float>(nowMs - lastStateMs_);
    // A slow average of the time between states; a long gap (lost states) does not count.
    if (dt > 5 && dt < 400) intervalMs_ += (dt - intervalMs_) * 0.2f;
  }
  haveState_ = true;
  lastStateMs_ = nowMs;

  bool seen[kMaxPlayers] = {};
  for (const auto& p : s.players) {
    if (p.id >= kMaxPlayers || !(p.flags & boardlink::kInGame)) continue;
    seen[p.id] = true;
    SmoothDot& d = dots_[p.id];
    Track& tr = tracks_[p.id];
    const RoadPos target = g_.nearest(p.u, p.v);
    // Way along the roads from where the dot is drawn now to its new place.
    tr.pieceCount = 0;
    if (d.active) {
      tr.pieceCount = g_.route(d.pos, target, tr.pieces, 12, tr.length);
    }
    if (tr.pieceCount == 0 || tr.length > tune_.jumpLength) {
      // First state, or a jump (a new game, a lift after a fall far away).
      tr.pieces[0] = {target.seg, target.t, target.t};
      tr.pieceCount = 1;
      tr.length = 0;
      d.trailCount = 0;
    }
    tr.startMs = nowMs;
    tr.end = target;
    const RoadGraph::Piece& last = tr.pieces[tr.pieceCount - 1];
    if (last.t1 != last.t0) {
      tr.towardB = last.t1 > last.t0;
    } else {
      // Standing, or the first state: the heading gives the direction for coasting.
      const RoadSegment& seg = g_.segment(target.seg);
      const RoadNode& a = g_.node(seg.a);
      const RoadNode& b = g_.node(seg.b);
      const float rad = p.heading * 3.14159265f / 180.0f;
      const float hu = std::sin(rad), hv = -std::cos(rad);  // clockwise from north, v grows south
      tr.towardB = (b.u - a.u) * hu + (b.v - a.v) * hv >= 0;
    }
    tr.speedUv = p.speed > 0 && !(p.flags & boardlink::kFallen) ? p.speed / tune_.worldSizeM / 1000.0f : 0;
    d.active = true;
  }
  for (uint8_t i = 0; i < kMaxPlayers; i++) {
    if (!seen[i]) dots_[i].active = false;
  }
}

RoadPos MotionSmoother::along(const Track& tr, float d) const {
  for (uint8_t i = 0; i < tr.pieceCount; i++) {
    const RoadGraph::Piece& pc = tr.pieces[i];
    const float len = std::fabs(pc.t1 - pc.t0) * g_.segment(pc.seg).length;
    if (d <= len || i + 1 == tr.pieceCount) {
      const float f = len > 0 ? (d < len ? d / len : 1.0f) : 1.0f;
      return RoadPos{pc.seg, pc.t0 + (pc.t1 - pc.t0) * f};
    }
    d -= len;
  }
  return tr.end;
}

void MotionSmoother::update(uint32_t nowMs) {
  for (uint8_t i = 0; i < kMaxPlayers; i++) {
    SmoothDot& d = dots_[i];
    if (!d.active) continue;
    const Track& tr = tracks_[i];
    const float elapsed = static_cast<float>(nowMs - tr.startMs);
    const float dur = intervalMs_ > 1 ? intervalMs_ : 1;
    if (elapsed <= dur) {
      d.pos = along(tr, tr.length * (elapsed / dur));
    } else {
      // No new state yet: go on along the road with the last speed, for a short time.
      RoadPos p = tr.end;
      bool towardB = tr.towardB;
      const float coast = elapsed - dur;
      const float ms = coast < tune_.coastMaxMs ? coast : static_cast<float>(tune_.coastMaxMs);
      g_.walk(p, towardB, tr.speedUv * ms);
      d.pos = p;
    }
    g_.place(d.pos, d.u, d.v);
    pushTrail(d);
  }
}

void MotionSmoother::pushTrail(SmoothDot& d) {
  const uint16_t led = ledOnSegment(d.pos.seg, d.pos.t < 0 ? 0 : (d.pos.t > 1 ? 1 : d.pos.t));
  if (led == kNoLed) return;
  if (d.trailCount > 0 && d.trail[0] == led) return;
  const uint8_t n = d.trailCount < kMaxTail ? d.trailCount + 1 : kMaxTail;
  for (uint8_t k = n - 1; k > 0; k--) d.trail[k] = d.trail[k - 1];
  d.trail[0] = led;
  d.trailCount = n;
}

}  // namespace led
