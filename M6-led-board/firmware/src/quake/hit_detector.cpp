#include "hit_detector.h"

#include <algorithm>
#include <cmath>

namespace quake {

namespace {
float clampf(float x, float lo, float hi) { return std::max(lo, std::min(hi, x)); }
float alphaFor(float seconds, float hz) { return 1.0f - std::exp(-1.0f / (seconds * hz)); }
int samplesFor(float ms, float hz) { return std::max(1, int(std::lround(ms * hz / 1000.0f))); }
}  // namespace

HitDetector::HitDetector(const QuakeCalibration& cal, const DetectorTiming& timing)
    : cal_(cal),
      t_(timing),
      gravityAlpha_(alphaFor(timing.gravitySeconds, timing.sampleHz)),
      noiseAlpha_(alphaFor(timing.noiseSeconds, timing.sampleHz)),
      windowSamples_(samplesFor(timing.windowMs, timing.sampleHz)),
      waitSamples_(samplesFor(timing.waitAfterHitMs, timing.sampleHz)),
      learnSamples_(samplesFor(timing.learnSeconds * 1000.0f, timing.sampleHz)),
      settleSamples_(samplesFor(timing.motorSettleMs, timing.sampleHz)) {}

float HitDetector::threshold() const { return std::max(cal_.floorG, cal_.noiseFactor * noise_); }

float HitDetector::strengthFor(float peakG) const {
  if (peakG <= 0) return 0;
  float m = 5.0f + cal_.magPerDoubling * std::log2(peakG / cal_.standardPeakG);
  return clampf(m, 0.0f, 10.0f);
}

void HitDetector::setMotorsRunning(bool running) {
  if (motors_ && !running) settle_ = settleSamples_;
  if (running && !motors_) {  // a new vibrate command is a new earthquake
    settle_ = 0;
    motorEventSent_ = false;
  }
  motors_ = running;
}

void HitDetector::toBoardAxes(float& x, float& y) const {
  if (cal_.swapXY) std::swap(x, y);
  if (cal_.flipX) x = -x;
  if (cal_.flipY) y = -y;
}

bool HitDetector::addSample(const ImuSample& s, QuakeEvent& out) {
  const float raw[6] = {s.ax, s.ay, s.az, s.gx, s.gy, s.gz};
  if (!started_) {
    std::copy(raw, raw + 6, base_);
    started_ = true;
  }

  // 1. Only the shaking: the sample minus the slow average.
  float hp[6];
  for (int i = 0; i < 6; i++) hp[i] = raw[i] - base_[i];
  const float shake = std::sqrt(hp[0] * hp[0] + hp[1] * hp[1] + hp[2] * hp[2]);
  lastShake_ = shake;

  // Motors on, or stopped only a moment ago: their shaking is not a hand hit.
  const bool motorShake = motors_ || settle_ > 0;
  if (!motors_ && settle_ > 0 && --settle_ == 0) motorEventSent_ = false;

  // 2a. Right after power on: only learn the room noise (plain average).
  if (learned_ < learnSamples_) {
    learned_++;
    for (int i = 0; i < 6; i++) base_[i] += gravityAlpha_ * (raw[i] - base_[i]);
    if (!motorShake) noise_ += (shake - noise_) / float(learned_);
    return false;
  }

  switch (mode_) {
    case Mode::Idle: {
      if (shake > threshold()) {
        // While the motors run there is only one event for the whole shaking.
        if (motorShake && motorEventSent_) return false;
        mode_ = Mode::InWindow;
        windowSource_ = motorShake ? Source::Motor : Source::Hit;
        count_ = 0;
        peak_ = 0;
        pushX_ = pushY_ = pushZ_ = tiltX_ = tiltY_ = 0;
        [[fallthrough]];
      } else {
        // The slow average follows only quiet samples, never a hit or its ringing.
        for (int i = 0; i < 6; i++) base_[i] += gravityAlpha_ * (raw[i] - base_[i]);
        // 2. Learn the room noise, never while the motors run.
        if (!motorShake) noise_ += noiseAlpha_ * (shake - noise_);
        return false;
      }
    }
    case Mode::InWindow: {
      peak_ = std::max(peak_, shake);
      if (count_ < t_.pushSamples) {
        pushX_ += hp[0];
        pushY_ += hp[1];
        pushZ_ += std::fabs(hp[2]);
      }
      // Tilt rate around x and y over the window.
      tiltX_ += hp[3];
      tiltY_ += hp[4];
      if (++count_ < windowSamples_) return false;
      finishEvent(out);
      mode_ = Mode::Waiting;
      count_ = 0;
      return true;
    }
    case Mode::Waiting:
      if (++count_ >= waitSamples_) mode_ = Mode::Idle;
      return false;
  }
  return false;
}

void HitDetector::finishEvent(QuakeEvent& out) {
  out = QuakeEvent{};
  out.id = nextId_++;
  out.src = windowSource_;
  out.peakG = peak_;
  out.mag = strengthFor(peak_);
  if (windowSource_ == Source::Motor) motorEventSent_ = true;

  // 5. Side of the hit: direction of the first sideways push, helped by the tilt.
  //    A hit on the east side tilts the board around the y axis, so the tilt
  //    direction (tiltY, -tiltX) points to the side of the hit.
  float px = pushX_, py = pushY_;
  float tx = tiltY_, ty = -tiltX_;
  toBoardAxes(px, py);
  toBoardAxes(tx, ty);
  const float pushLen = std::hypot(px, py);
  const float tiltLen = std::hypot(tx, ty);
  float dx = 0, dy = 0;
  if (pushLen > 1e-6f) { dx += px / pushLen; dy += py / pushLen; }
  if (tiltLen > 1e-6f) { dx += cal_.gyroWeight * tx / tiltLen; dy += cal_.gyroWeight * ty / tiltLen; }
  const float dLen = std::hypot(dx, dy);
  if (dLen > 1e-6f) { dx /= dLen; dy /= dLen; }

  //    Distance from the centre: a hit in the middle pushes the board mostly
  //    down, a hit at the edge pushes it more to the side.
  const float share = pushLen / (pushLen + pushZ_ + 1e-6f);
  const float r = clampf(share / cal_.edgeShare, 0.0f, 1.0f);

  out.u = clampf(0.5f + 0.5f * r * dx, 0.0f, 1.0f);
  out.v = clampf(0.5f + 0.5f * r * dy, 0.0f, 1.0f);
  const int col = std::min(2, int(out.u * 3.0f));
  const int row = std::min(2, int(out.v * 3.0f));
  out.zone = uint8_t(row * 3 + col);

  //    Confidence: do push and tilt agree, and how clearly is the hit above the threshold.
  float agree = 0.5f;
  if (pushLen > 1e-6f && tiltLen > 1e-6f) agree = 0.5f * (1.0f + (px * tx + py * ty) / (pushLen * tiltLen));
  const float clear = clampf((peak_ / threshold() - 1.0f) / 3.0f, 0.0f, 1.0f);
  out.conf = std::round((0.5f * agree + 0.5f * clear) * 100.0f) / 100.0f;
}

}  // namespace quake
