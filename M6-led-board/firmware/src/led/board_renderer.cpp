#include "board_renderer.h"

#include <cmath>

namespace led {

using boardlink::BoardConfig;
using boardlink::BoardState;

namespace {
constexpr float kPi = 3.14159265f;

/** 0..1..0 once every `periodMs`. */
float wave(uint32_t now, uint32_t periodMs) {
  return 0.5f - 0.5f * std::cos(2 * kPi * static_cast<float>(now % periodMs) / periodMs);
}

bool blinkOn(uint32_t now, float hz) {
  if (!(hz > 0)) return true;
  const uint32_t period = static_cast<uint32_t>(1000.0f / hz);
  return period == 0 || (now % period) < period / 2;
}

float ledUf(uint16_t i) { return mapdata::kLeds[i].u / 65535.0f; }
float ledVf(uint16_t i) { return mapdata::kLeds[i].v / 65535.0f; }

constexpr Rgb kRoad{18, 18, 16};
constexpr Rgb kRed{255, 0, 0};
constexpr Rgb kPuddle{70, 170, 255};
constexpr Rgb kWhite{255, 255, 255};
constexpr Rgb kQuake{255, 140, 40};
}  // namespace

// Four hues, a light and a dark tone each. Chosen so that the 8 differ by hue, not only by
// brightness (an LED dot is small): light = the team colour, dark = a clearly other hue next to it.
const Rgb kDefaultTones[8] = {
    {0, 170, 255},  {0, 0, 255},     // team 0 blue: sky blue, deep blue
    {120, 255, 0},  {0, 255, 90},    // team 1 green: lime, sea green
    {200, 0, 255},  {255, 0, 140},   // team 2 purple: violet, magenta
    {255, 210, 0},  {255, 90, 0},    // team 3 yellow: yellow, orange
};

const Rgb kTeamColours[4] = {{0, 80, 255}, {0, 255, 40}, {170, 0, 255}, {255, 200, 0}};

Rgb scale(Rgb c, float k) {
  if (k < 0) k = 0;
  if (k > 1) k = 1;
  return Rgb{static_cast<uint8_t>(c.r * k + 0.5f), static_cast<uint8_t>(c.g * k + 0.5f),
             static_cast<uint8_t>(c.b * k + 0.5f)};
}

Rgb add(Rgb a, Rgb b) {
  auto s = [](int x, int y) { return static_cast<uint8_t>(x + y > 255 ? 255 : x + y); };
  return Rgb{s(a.r, b.r), s(a.g, b.g), s(a.b, b.b)};
}

BoardRenderer::BoardRenderer(const RoadGraph& g) : g_(g), smoother_(g) {}

Rgb BoardRenderer::tone(const BoardConfig& cfg, uint8_t team, uint8_t toneIdx) const {
  const uint8_t k = static_cast<uint8_t>((team & 3) * 2 + (toneIdx & 1));
  const boardlink::Rgb c = cfg.tones[k];
  if (c.r == 0 && c.g == 0 && c.b == 0) return kDefaultTones[k];
  return Rgb{c.r, c.g, c.b};
}

void BoardRenderer::onState(const BoardState& s, uint32_t nowMs) {
  // Delivery flash: only when a point turns from waiting (0) to delivered (1). The server may
  // send `delivered = 1` in many states one after the other; that is still one delivery.
  for (const auto& p : s.points) {
    if (!p.delivered) continue;
    bool wasDelivered = false;
    for (const auto& q : state_.points) {
      if (q.delivered && std::fabs(q.u - p.u) < 0.01f && std::fabs(q.v - p.v) < 0.01f) wasDelivered = true;
    }
    if (haveState_ && wasDelivered) continue;
    Flash* slot = &flashes_[0];
    for (auto& f : flashes_) {
      if (!f.on || f.startMs < slot->startMs) slot = &f;
      if (!f.on) break;
    }
    *slot = Flash{p.u, p.v, nowMs, kWhite, true};
  }
  // "Find me": 1 s of white from the moment the flag comes on.
  bool flag[kMaxPlayers] = {};
  for (const auto& p : s.players) {
    if (p.id < kMaxPlayers) flag[p.id] = p.flags & boardlink::kFindMe;
  }
  for (uint8_t i = 0; i < kMaxPlayers; i++) {
    if (flag[i] && !findMeOn_[i]) findMeStart_[i] = nowMs;
    findMeOn_[i] = flag[i];
  }
  state_ = s;
  stateMs_ = nowMs;
  haveState_ = true;
  smoother_.onState(s, nowMs);
}

void BoardRenderer::draw(Frame& f, uint32_t now, const BoardConfig& cfg, boardlink::LinkState link) {
  f.fill(Rgb{});
  if (link != boardlink::LinkState::Connected || !haveState_) {
    drawSearching(f, now);
    return;
  }
  smoother_.update(now);
  switch (state_.phase) {
    case 0:  // lobby: roads breathe slowly, stores on, joined players shown where they wait
      drawRoads(f, scale(kRoad, 0.3f + 0.7f * wave(now, 4000)), 0.6f);
      drawBikes(f, now, cfg);
      break;
    case 1:  // countdown
      drawCountdown(f, now);
      break;
    case 3: {  // pause: the game stands, dim, and the stores pulse
      drawRoads(f, kRoad, 0.3f + 0.5f * wave(now, 2000));
      drawObstacles(f, now);
      drawPoints(f, now, cfg);
      drawBikes(f, now, cfg);
      for (auto& c : f) c = scale(c, 0.35f);
      break;
    }
    case 4:  // end
      drawEnd(f, now);
      break;
    case 2:
    default:
      drawRoads(f, kRoad, 0.7f);
      drawObstacles(f, now);
      drawPoints(f, now, cfg);
      drawBikes(f, now, cfg);
      break;
  }
  drawEffects(f, now);
}

void BoardRenderer::drawRoads(Frame& f, Rgb road, float storeLevel) {
  for (uint16_t i = 0; i < kLedCount; i++) {
    const auto& l = mapdata::kLeds[i];
    if (l.segment >= 0) f[i] = road;
    else if (l.store >= 0) f[i] = scale(kTeamColours[l.store & 3], storeLevel);
  }
}

void BoardRenderer::drawObstacles(Frame& f, uint32_t now) {
  for (const auto& ob : state_.obstacles) {
    if (ob.segment >= mapdata::kSegmentCount) continue;
    const mapdata::SegmentRow& row = mapdata::kSegments[ob.segment];
    for (uint8_t k = 0; k < row.count; k++) {
      const uint16_t i = row.first + k;
      const uint8_t along = row.reversed ? row.count - 1 - k : k;
      Rgb c{};
      switch (ob.type) {
        case 1:  // heavy traffic: red dashes that crawl along the road
          c = ((along + now / 250) % 3 == 0) ? scale(kRed, 0.15f) : kRed;
          break;
        case 2:  // road work: solid red with a dark gap every third LED (a barrier)
          c = along % 3 == 1 ? Rgb{} : kRed;
          break;
        case 3:  // accident: the whole road blinks red, fast
          c = blinkOn(now, 3.0f) ? kRed : scale(kRed, 0.1f);
          break;
        case 4:  // puddle: light blue that shimmers softly
          c = scale(kPuddle, 0.6f + 0.4f * wave(now + along * 170u, 1500));
          break;
        default:
          continue;
      }
      f[i] = c;
    }
  }
}

void BoardRenderer::drawPoints(Frame& f, uint32_t now, const BoardConfig& cfg) {
  for (const auto& p : state_.points) {
    if (p.delivered) continue;  // the flash effect shows it
    const uint16_t led = nearestRoadLed(p.u, p.v);
    if (led == kNoLed) continue;
    uint8_t team = 0, toneIdx = 0;
    for (const auto& pl : state_.players) {
      if (pl.id == p.owner) {
        team = pl.team;
        toneIdx = pl.tone;
      }
    }
    if (blinkOn(now, cfg.dpBlinkHz)) f[led] = tone(cfg, team, toneIdx);
  }
}

void BoardRenderer::drawBikes(Frame& f, uint32_t now, const BoardConfig& cfg) {
  // Which dots are on which LED: two dots on one LED take turns, 300 ms each.
  uint16_t ledOf[kMaxPlayers];
  Rgb colourOf[kMaxPlayers];
  bool show[kMaxPlayers] = {};
  for (const auto& p : state_.players) {
    if (p.id >= kMaxPlayers) continue;
    const SmoothDot& d = smoother_.dot(p.id);
    if (!d.active || d.trailCount == 0) continue;
    Rgb c = tone(cfg, p.team, p.tone);
    if (findMeOn_[p.id] && now - findMeStart_[p.id] < 1000) c = kWhite;
    else if (p.flags & boardlink::kFallen) c = blinkOn(now, 4.0f) ? c : scale(c, 0.15f);
    ledOf[p.id] = d.trail[0];
    colourOf[p.id] = c;
    show[p.id] = true;
    // Tail: the LEDs just passed, fading.
    const uint8_t tail = cfg.tail < d.trailCount ? cfg.tail : d.trailCount - 1;
    for (uint8_t k = 1; k <= tail && k < d.trailCount; k++) {
      const float level = 0.35f / k;
      f[d.trail[k]] = add(scale(f[d.trail[k]], 0.5f), scale(c, level));
    }
  }
  for (uint8_t i = 0; i < kMaxPlayers; i++) {
    if (!show[i]) continue;
    uint8_t same[kMaxPlayers];
    uint8_t n = 0;
    for (uint8_t j = 0; j < kMaxPlayers; j++) {
      if (show[j] && ledOf[j] == ledOf[i]) same[n++] = j;
    }
    const uint8_t turn = same[(now / 300) % n];
    f[ledOf[i]] = colourOf[turn];
  }
}

void BoardRenderer::drawEffects(Frame& f, uint32_t now) {
  // Earthquake: a ring of light grows from the centre and fades.
  const auto& q = state_.quake;
  if (q.on) {
    const float age = (q.ageMs + (now - stateMs_)) / 1000.0f;
    const float cycle = std::fmod(age, 2.0f);  // a new ring every 2 s while it lasts
    const float radius = 0.08f + cycle * 0.45f;
    const float width = 0.06f;
    const float level = (1.0f - cycle / 2.0f) * (0.3f + 0.07f * q.mag);
    for (uint16_t i = 0; i < kLedCount; i++) {
      const float d = std::hypot(ledUf(i) - q.u, ledVf(i) - q.v);
      const float k = 1.0f - std::fabs(d - radius) / width;
      if (k > 0) f[i] = add(f[i], scale(kQuake, k * level));
    }
  }
  // Delivery flash: a bright burst around the point, 0.6 s.
  for (auto& fl : flashes_) {
    if (!fl.on) continue;
    const uint32_t age = now - fl.startMs;
    if (age > 600) {
      fl.on = false;
      continue;
    }
    const float level = 1.0f - age / 600.0f;
    const float radius = 0.02f + 0.05f * (age / 600.0f);
    for (uint16_t i = 0; i < kLedCount; i++) {
      const float d = std::hypot(ledUf(i) - fl.u, ledVf(i) - fl.v);
      if (d < radius) f[i] = add(f[i], scale(fl.colour, level * (1.0f - d / radius)));
    }
  }
}

void BoardRenderer::drawSearching(Frame& f, uint32_t now) {
  // Roads dark, the stores breathe in soft white.
  const Rgb soft = scale(Rgb{200, 200, 190}, 0.08f + 0.35f * wave(now, 3000));
  for (uint16_t i = 0; i < kLedCount; i++) {
    if (mapdata::kLeds[i].store >= 0) f[i] = soft;
  }
}

void BoardRenderer::drawCountdown(Frame& f, uint32_t now) {
  // Every second the whole board flashes and fades; the stores grow brighter to the start.
  const uint32_t since = now - stateMs_;
  const float phase = static_cast<float>(since % 1000) / 1000.0f;
  const float pulse = 1.0f - phase;
  const float near = state_.timeLeft <= 1 ? 1.0f : (state_.timeLeft <= 3 ? 0.7f : 0.4f);
  drawRoads(f, scale(Rgb{255, 255, 255}, 0.05f + 0.25f * pulse * near), near);
}

void BoardRenderer::drawEnd(Frame& f, uint32_t now) {
  // A chase along every road in the winner colour; a draw takes turns between the winners.
  uint8_t mask = winners_ & 0x0F;
  if (mask == 0) mask = 0x0F;
  uint8_t teams[4];
  uint8_t n = 0;
  for (uint8_t t = 0; t < 4; t++) {
    if (mask & (1u << t)) teams[n++] = t;
  }
  const uint8_t shown = teams[(now / 1500) % n];
  const Rgb c = kTeamColours[shown];
  for (uint16_t i = 0; i < kLedCount; i++) {
    const auto& l = mapdata::kLeds[i];
    if (l.store >= 0) {
      f[i] = (mask & (1u << (l.store & 3))) ? scale(kTeamColours[l.store & 3], 0.5f + 0.5f * wave(now, 800))
                                            : scale(kTeamColours[l.store & 3], 0.08f);
    } else if (l.segment >= 0) {
      const mapdata::SegmentRow& row = mapdata::kSegments[l.segment];
      const uint16_t k = static_cast<uint16_t>(i - row.first);
      const uint16_t along = row.reversed ? row.count - 1 - k : k;
      f[i] = ((along + now / 80) % 6 < 2) ? c : scale(c, 0.1f);
    }
  }
}

}  // namespace led
