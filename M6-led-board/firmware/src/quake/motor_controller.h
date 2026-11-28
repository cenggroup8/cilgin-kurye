// M6-2 motor controller: runs the four vibration motors for a vibrate command.
//
//  - Soft start: the power grows from 0 to the asked strength over the ramp time,
//    so the power never jumps.
//  - Safety limits: the strength and the time are cut to the limits below.
//  - Link lost: update() with linkUp = false stops every motor at once.
//
// The motors sit under the four corners. Bit i of the mask is motor i:
//   bit 0 = zone 0 (north-west), bit 1 = zone 2 (north-east),
//   bit 2 = zone 6 (south-west), bit 3 = zone 8 (south-east).
// Choosing the motors for a zone is M1's job; this part only runs the mask it gets.
#pragma once
#include <cstdint>

namespace quake {

constexpr int kMotorCount = 4;
constexpr uint8_t kMotorZone[kMotorCount] = {0, 2, 6, 8};

// The "V" message of the board protocol.
struct VibrateCommand {
  uint8_t mask = 0;      // which motors, bits 0-3
  float duty = 0;        // strength 0 to 1
  uint32_t ms = 0;       // how long
  uint32_t rampMs = 0;   // soft start time
};

struct MotorLimits {
  float maxDuty = 0.8f;      // never more power than this
  uint32_t maxMs = 5000;     // never longer than this
  uint32_t minRampMs = 150;  // never a shorter soft start than this
};

// The pins and the PWM come from the wiring (M6-5); in the tests it is a fake.
class MotorOutput {
 public:
  virtual ~MotorOutput() = default;
  virtual void setDuty(int motor, float duty) = 0;  // duty 0 to 1
};

class MotorController {
 public:
  MotorController(MotorOutput& out, const MotorLimits& limits = {});

  // A new command replaces the running one. Returns false if it does nothing.
  bool start(const VibrateCommand& cmd, uint32_t nowMs);
  void stop();

  // Call every loop. Sets the motor power for this moment.
  void update(uint32_t nowMs, bool linkUp);

  bool running() const { return running_; }
  float duty(int motor) const { return current_[motor]; }
  const MotorLimits& limits() const { return limits_; }

 private:
  void apply(float level);

  MotorOutput& out_;
  MotorLimits limits_;
  bool running_ = false;
  uint8_t mask_ = 0;
  float target_ = 0;
  uint32_t startMs_ = 0, durationMs_ = 0, rampMs_ = 0;
  float current_[kMotorCount] = {0, 0, 0, 0};
};

}  // namespace quake
