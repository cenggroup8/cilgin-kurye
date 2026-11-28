// M6-2 hit detector: finds hand hits and motor shaking in the sensor samples.
//
//  1. A slow average per axis is taken away, so gravity and slow tilting go
//     and only the shaking is left.
//  2. The detector learns the normal noise of the room and puts the start
//     threshold well above it (never while the motors run).
//  3. When the shaking passes the threshold a hit starts; a short window is
//     taken from that moment.
//  4. Strength 0-10 from the strongest shaking in the window (log scale).
//  5. Zone 0-8 and confidence from the first push (accelerometer) and the
//     tilt (gyroscope).
//  6. After a hit the detector waits a short time, so one hit is one event.
//     While the motors run (and a short time after), the whole shaking gives
//     one "motor" event.
//
// For the first seconds after power on it only learns the room noise.
//
// It never waits or blocks: the main loop calls addSample() for each sample.
#pragma once
#include <cstdint>
#include "calibration.h"
#include "quake_types.h"

namespace quake {

struct DetectorTiming {
  float sampleHz = 200.0f;
  float gravitySeconds = 0.5f;  // how slowly the gravity / tilt average follows
  float noiseSeconds = 2.0f;    // how slowly the room noise is learned
  float windowMs = 80.0f;       // hit window
  int pushSamples = 3;          // samples of the first push used for the side
  float waitAfterHitMs = 400.0f;
  float learnSeconds = 3.0f;    // at the start: only learn the room noise, no events
  float motorSettleMs = 500.0f; // after the motors stop, their shaking still counts as motors
};

class HitDetector {
 public:
  explicit HitDetector(const QuakeCalibration& cal = {}, const DetectorTiming& timing = {});

  // Feed one sample. Returns true and fills `out` when an event is finished.
  bool addSample(const ImuSample& s, QuakeEvent& out);

  // Told by the motor controller each loop.
  void setMotorsRunning(bool running);

  void setCalibration(const QuakeCalibration& cal) { cal_ = cal; }
  const QuakeCalibration& calibration() const { return cal_; }

  // The shaking after filtering (g); this is what the seismic graph shows.
  float lastShake() const { return lastShake_; }
  float noiseLevel() const { return noise_; }
  float threshold() const;

  // Strength 0-10 for a peak shaking, on the calibrated scale.
  float strengthFor(float peakG) const;

 private:
  enum class Mode { Idle, InWindow, Waiting };

  void finishEvent(QuakeEvent& out);
  void toBoardAxes(float& x, float& y) const;

  QuakeCalibration cal_;
  DetectorTiming t_;
  float gravityAlpha_, noiseAlpha_;
  int windowSamples_, waitSamples_, learnSamples_, settleSamples_;

  bool started_ = false;
  float base_[6] = {0, 0, 0, 0, 0, 0};  // slow average of ax ay az gx gy gz
  float noise_ = 0;
  float lastShake_ = 0;

  Mode mode_ = Mode::Idle;
  int count_ = 0;
  int learned_ = 0;
  bool motors_ = false;
  int settle_ = 0;
  bool motorEventSent_ = false;
  Source windowSource_ = Source::Hit;

  float peak_ = 0;
  float pushX_ = 0, pushY_ = 0, pushZ_ = 0;
  float tiltX_ = 0, tiltY_ = 0;
  uint32_t nextId_ = 1;
};

}  // namespace quake
