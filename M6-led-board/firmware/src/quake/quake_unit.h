// M6-2 in the main loop: sensor at a fixed rate -> hit detector -> events,
// sensor samples for the graph, and the motors. The link part (M6-1) gives the
// link state and sends what comes out through the two callbacks.
#pragma once
#include <cstdint>
#include "fixed_rate.h"
#include "hit_detector.h"
#include "motor_controller.h"
#include "sample_batcher.h"

namespace quake {

// The motion sensor driver (chosen after the sensor test, M6-2 / M6-5).
class MotionSensor {
 public:
  virtual ~MotionSensor() = default;
  virtual bool read(ImuSample& out) = 0;  // false if no new sample
};

class QuakeUnit {
 public:
  using EventFn = void (*)(const QuakeEvent&, void* ctx);
  using SamplesFn = void (*)(int hz, const float* values, int count, void* ctx);

  QuakeUnit(MotionSensor& sensor, MotorOutput& motors, const QuakeCalibration& cal = {},
            const DetectorTiming& timing = {}, const MotorLimits& limits = {})
      : sensor_(sensor), rate_(uint32_t(timing.sampleHz)), detector_(cal, timing), motors_(motors, limits),
        batcher_(int(timing.sampleHz), 100) {}

  void onEvent(EventFn fn, void* ctx) { eventFn_ = fn; eventCtx_ = ctx; }
  void onSamples(SamplesFn fn, void* ctx) { samplesFn_ = fn; samplesCtx_ = ctx; }

  void vibrate(const VibrateCommand& cmd, uint32_t nowMs) { motors_.start(cmd, nowMs); }

  // Call once per main loop. Never waits.
  void loop(uint32_t nowUs, uint32_t nowMs, bool linkUp) {
    motors_.update(nowMs, linkUp);
    detector_.setMotorsRunning(motors_.running());
    if (!rate_.due(nowUs)) return;
    ImuSample s;
    if (!sensor_.read(s)) return;
    QuakeEvent ev;
    if (detector_.addSample(s, ev) && eventFn_) eventFn_(ev, eventCtx_);
    if (batcher_.add(detector_.lastShake())) {
      if (samplesFn_) samplesFn_(batcher_.hz(), batcher_.values(), int(batcher_.size()), samplesCtx_);
      batcher_.clear();
    }
  }

  HitDetector& detector() { return detector_; }
  MotorController& motors() { return motors_; }

 private:
  MotionSensor& sensor_;
  FixedRate rate_;
  HitDetector detector_;
  MotorController motors_;
  SampleBatcher<10> batcher_;
  EventFn eventFn_ = nullptr;
  void* eventCtx_ = nullptr;
  SamplesFn samplesFn_ = nullptr;
  void* samplesCtx_ = nullptr;
};

}  // namespace quake
