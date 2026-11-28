#include "motor_controller.h"

#include <algorithm>

namespace quake {

MotorController::MotorController(MotorOutput& out, const MotorLimits& limits) : out_(out), limits_(limits) {
  for (int i = 0; i < kMotorCount; i++) out_.setDuty(i, 0);
}

bool MotorController::start(const VibrateCommand& cmd, uint32_t nowMs) {
  const uint8_t mask = cmd.mask & 0x0F;
  const float duty = std::max(0.0f, std::min(cmd.duty, limits_.maxDuty));
  const uint32_t ms = std::min(cmd.ms, limits_.maxMs);
  if (mask == 0 || duty <= 0 || ms == 0) {
    stop();
    return false;
  }
  // Motors not in the new mask stop at once.
  for (int i = 0; i < kMotorCount; i++)
    if (!(mask & (1u << i)) && current_[i] != 0) {
      current_[i] = 0;
      out_.setDuty(i, 0);
    }
  mask_ = mask;
  target_ = duty;
  durationMs_ = ms;
  rampMs_ = std::min(std::max(cmd.rampMs, limits_.minRampMs), ms);
  startMs_ = nowMs;
  running_ = true;
  apply(0);
  return true;
}

void MotorController::stop() {
  running_ = false;
  for (int i = 0; i < kMotorCount; i++) {
    current_[i] = 0;
    out_.setDuty(i, 0);
  }
}

void MotorController::apply(float level) {
  for (int i = 0; i < kMotorCount; i++) {
    const float d = (mask_ & (1u << i)) ? level : 0.0f;
    if (d != current_[i]) {
      current_[i] = d;
      out_.setDuty(i, d);
    }
  }
}

void MotorController::update(uint32_t nowMs, bool linkUp) {
  if (!running_) return;
  if (!linkUp) {
    stop();
    return;
  }
  const uint32_t t = nowMs - startMs_;  // unsigned: works over the millis() wrap
  if (t >= durationMs_) {
    stop();
    return;
  }
  const float level = t < rampMs_ ? target_ * float(t) / float(rampMs_) : target_;
  apply(level);
}

}  // namespace quake
