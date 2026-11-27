#include "post_process.h"

#include <array>
#include <cmath>

namespace led {

namespace {

std::array<uint8_t, 256> makeGamma() {
  std::array<uint8_t, 256> t{};
  for (int i = 0; i < 256; i++) {
    t[i] = static_cast<uint8_t>(std::lround(255.0 * std::pow(i / 255.0, 2.2)));
  }
  return t;
}

const std::array<uint8_t, 256> kGamma = makeGamma();

uint8_t scale(uint8_t v, float f) {
  const long s = std::lround(v * f);
  return static_cast<uint8_t>(s < 0 ? 0 : s > 255 ? 255 : s);
}

}  // namespace

uint8_t gamma8(uint8_t v) { return kGamma[v]; }

PostProcessor::PostProcessor(const PowerModel& model) : model_(model) {}

void PostProcessor::setConfig(float bright, uint16_t maxMa) {
  if (!(bright >= 0.1f)) bright = 0.1f;  // also catches NaN
  if (bright > 1.0f) bright = 1.0f;
  bright_ = bright;
  maxMa_ = maxMa;
}

uint32_t PostProcessor::estimateMa(const Rgb* frame, uint16_t count) const {
  uint32_t sum = 0;  // sum of all channel values, at most 728 × 765
  for (uint16_t i = 0; i < count; i++) sum += frame[i].r + frame[i].g + frame[i].b;
  return static_cast<uint32_t>(std::lround(sum * model_.maPerChannel / 255.0f + count * model_.idleMa));
}

PostResult PostProcessor::process(const Rgb* in, Rgb* out, uint16_t count) const {
  PostResult r;
  for (uint16_t i = 0; i < count; i++) {
    out[i].r = scale(kGamma[in[i].r], bright_);
    out[i].g = scale(kGamma[in[i].g], bright_);
    out[i].b = scale(kGamma[in[i].b], bright_);
  }
  r.maBefore = estimateMa(out, count);
  r.maEst = r.maBefore;
  const float idle = count * model_.idleMa;
  if (r.maBefore > maxMa_) {
    // The current above the idle current grows with the values, so one factor brings it down.
    const float lit = r.maBefore - idle;
    float f = lit > 0.0f ? (maxMa_ - idle) / lit : 0.0f;
    if (f < 0.0f) f = 0.0f;
    // Rounding can add a little; lower the factor until the estimate is under the limit.
    for (int tries = 0; tries < 8; tries++) {
      for (uint16_t i = 0; i < count; i++) {
        out[i].r = scale(kGamma[in[i].r], bright_ * f);
        out[i].g = scale(kGamma[in[i].g], bright_ * f);
        out[i].b = scale(kGamma[in[i].b], bright_ * f);
      }
      r.maEst = estimateMa(out, count);
      if (r.maEst <= maxMa_ || f == 0.0f) break;
      f *= 0.98f;
    }
    r.powerScale = f;
    r.limited = true;
  }
  return r;
}

}  // namespace led
