#include "demo_mode.h"

#include <cmath>

namespace led {

using boardlink::BoardState;

namespace {
// Start places: two players next to each team store (stores are at the corners).
constexpr float kStartU[8] = {0.04f, 0.0f, 0.96f, 1.0f, 0.0f, 0.04f, 1.0f, 0.96f};
constexpr float kStartV[8] = {0.0f, 0.04f, 0.0f, 0.04f, 0.96f, 1.0f, 0.96f, 1.0f};
constexpr float kSpeed[8] = {11, 9, 12, 8, 10, 13, 9, 11};  // m/s

bool in(uint32_t t, uint32_t a, uint32_t b) { return t >= a && t < b; }
}  // namespace

DemoMode::DemoMode(const RoadGraph& g) : g_(g) {}

void DemoMode::start(uint32_t nowMs) {
  startMs_ = nowMs;
  lastStateMs_ = nowMs - kStateMs;
  started_ = true;
  seq_ = 0;
  simMs_ = 0;
  for (uint8_t i = 0; i < 8; i++) {
    pos_[i] = g_.nearest(kStartU[i], kStartV[i]);
    towardB_[i] = (i % 2) == 0;
  }
}

const char* DemoMode::partName(uint32_t t) {
  t %= kLoopMs;
  if (t < 5000) return "lobby";
  if (t < 8000) return "countdown";
  if (t < 38000) return "game";
  if (t < 42000) return "pause";
  if (t < 46000) return "game";
  if (t < 51000) return "end (team 2 wins)";
  if (t < 55000) return "end (draw 0 and 3)";
  return "searching";
}

DemoFrame DemoMode::step(uint32_t nowMs) {
  if (!started_) start(nowMs);
  DemoFrame out;
  const uint32_t t = (nowMs - startMs_) % kLoopMs;
  if (t < 100 && simMs_ > 1000) start(nowMs - t);  // a new round
  if (nowMs - lastStateMs_ >= kStateMs) {
    lastStateMs_ = nowMs;
    out.newState = true;
    makeState(t, out);
  }
  out.link = t >= 55000 ? boardlink::LinkState::Searching : boardlink::LinkState::Connected;
  out.winners = t < 51000 ? 0x04 : 0x09;
  return out;
}

void DemoMode::makeState(uint32_t t, DemoFrame& out) {
  BoardState& s = out.state;
  s.seq = ++seq_;
  const bool playing = in(t, 8000, 38000) || in(t, 42000, 46000);
  if (t < 5000) s.phase = 0;
  else if (t < 8000) s.phase = 1;
  else if (t < 38000) s.phase = 2;
  else if (t < 42000) s.phase = 3;
  else if (t < 46000) s.phase = 2;
  else s.phase = 4;
  s.timeLeft = s.phase == 1 ? static_cast<uint16_t>((8000 - t + 999) / 1000)
                            : static_cast<uint16_t>(t < 46000 ? (46000 - (t < 8000 ? 8000 : t)) / 1000 : 0);

  // Motorcycles move only while the game runs (player 5 lies fallen for 3 s).
  for (uint8_t i = 0; i < 8; i++) {
    const bool fallen = i == 5 && in(t, 18000, 21000);
    if (playing && !fallen) g_.walk(pos_[i], towardB_[i], kSpeed[i] / 500.0f * kStateMs / 1000.0f);
    boardlink::Player p;
    p.id = i;
    p.team = i / 2;
    p.tone = i % 2;
    p.flags = boardlink::kInGame | (i >= 6 ? boardlink::kBot : 0) | (fallen ? boardlink::kFallen : 0) |
              (in(t, 14000, 15000) && i == 2 ? boardlink::kFindMe : 0) | (i % 3 == 0 ? boardlink::kPackage : 0);
    g_.place(pos_[i], p.u, p.v);
    const RoadSegment& seg = g_.segment(pos_[i].seg);
    float du = g_.node(seg.b).u - g_.node(seg.a).u, dv = g_.node(seg.b).v - g_.node(seg.a).v;
    if (!towardB_[i]) {
      du = -du;
      dv = -dv;
    }
    float h = std::atan2(du, -dv) * 180.0f / 3.14159265f;
    p.heading = h < 0 ? h + 360 : h;
    p.speed = playing && !fallen ? kSpeed[i] : 0;
    s.players.push_back(p);
  }
  if (s.phase == 2 || s.phase == 3) {
    // One delivery point per player; every 6 s one of them is delivered (flash) and moves.
    for (uint8_t i = 0; i < 8; i++) {
      const uint32_t round = t / 6000;
      const uint8_t seg = static_cast<uint8_t>((i * 7 + round * 11 + 3) % g_.segmentCount());
      float u, v;
      g_.place(RoadPos{seg, 0.5f}, u, v);
      boardlink::DeliveryPoint dp;
      dp.owner = i;
      dp.u = u;
      dp.v = v;
      dp.delivered = (round % 8 == i && (t % 6000) > 5500) ? 1 : 0;
      s.points.push_back(dp);
    }
    // The four obstacle types.
    s.obstacles.push_back({12, 1, 0});
    s.obstacles.push_back({27, 2, 0});
    if (t >= 16000) s.obstacles.push_back({40, 3, 0});
    s.obstacles.push_back({51, 4, 0});
  }
  if (in(t, 22000, 28000)) {
    s.quake.on = true;
    s.quake.u = 0.5f;
    s.quake.v = 0.5f;
    s.quake.mag = 7;
    s.quake.ageMs = t - 22000;
  }
  simMs_ = t;
}

}  // namespace led
