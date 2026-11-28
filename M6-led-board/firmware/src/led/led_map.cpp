#include "led_map.h"

#include <cmath>

namespace led {

using mapdata::kLeds;
using mapdata::kSegments;

uint16_t chainStart(uint8_t chain) {
  uint16_t start = 0;
  for (uint8_t c = 0; c < chain && c < mapdata::kChainCount; c++) start += mapdata::kChainLeds[c];
  return start;
}

uint16_t ledOnSegment(uint8_t segment, float t) {
  if (segment >= mapdata::kSegmentCount || !(t >= 0.0f && t <= 1.0f)) return kNoLed;
  const mapdata::SegmentRow& s = kSegments[segment];
  // The LEDs of a piece are evenly spaced, so the nearest one is found from t alone.
  uint16_t best = s.first;
  float bestDist = 2.0f;
  for (uint8_t k = 0; k < s.count; k++) {
    const float d = std::fabs(kLeds[s.first + k].t / 255.0f - t);
    if (d < bestDist) {
      bestDist = d;
      best = s.first + k;
    }
  }
  return best;
}

uint16_t nearestRoadLed(float u, float v) {
  if (!(u >= -0.1f && u <= 1.1f && v >= -0.1f && v <= 1.1f)) return kNoLed;
  uint16_t best = kNoLed;
  float bestDist = 1e9f;
  for (uint16_t i = 0; i < kLedCount; i++) {
    if (kLeds[i].segment < 0) continue;
    const float du = kLeds[i].u / 65535.0f - u;
    const float dv = kLeds[i].v / 65535.0f - v;
    const float d = du * du + dv * dv;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

uint8_t storeLeds(uint8_t team, uint16_t* out, uint8_t max) {
  uint8_t n = 0;
  for (uint16_t i = 0; i < kLedCount && n < max; i++) {
    if (kLeds[i].store == static_cast<int8_t>(team)) out[n++] = i;
  }
  return n;
}

float ledU(uint16_t led) { return led < kLedCount ? kLeds[led].u / 65535.0f : 0.0f; }
float ledV(uint16_t led) { return led < kLedCount ? kLeds[led].v / 65535.0f : 0.0f; }
int8_t ledSegment(uint16_t led) { return led < kLedCount ? kLeds[led].segment : -1; }

}  // namespace led
