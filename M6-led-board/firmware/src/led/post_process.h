// Post processing of a frame (M6-3): colour correction for the eye, the brightness of the
// config, and the power limit. The mixed frame of M6-4 comes in; the colours that go to the
// strips come out.
//
//   out = gamma(in) × brightness × power scale
//
// The power limit: the current of the frame is estimated from the output values. If it
// would be above `max_ma`, every LED is dimmed by the same factor, so the picture keeps its
// look and the current stays under the limit (doc 10.3, pins_and_power.md: max_ma = 8000).
#pragma once
#include <cstdint>

#include "led_map.h"

namespace led {

/** Current model of one WS2812B LED. 728 LEDs at full white give about 44 A (strip_layout.md). */
struct PowerModel {
  float maPerChannel = 20.0f;  // one colour at 255
  float idleMa = 1.0f;         // an LED that is off still takes this
};

struct PostResult {
  uint32_t maBefore = 0;  // estimate before the power limit
  uint32_t maEst = 0;     // estimate of what is sent (for the status report)
  float powerScale = 1.0f;
  bool limited = false;
};

/** Colour correction for the eye (gamma 2.2), 0–255 to 0–255. */
uint8_t gamma8(uint8_t v);

class PostProcessor {
 public:
  explicit PostProcessor(const PowerModel& model = PowerModel{});

  /** From the config: brightness 0.1–1, power limit in mA. Values outside are clamped. */
  void setConfig(float bright, uint16_t maxMa);

  float bright() const { return bright_; }
  uint16_t maxMa() const { return maxMa_; }

  /** Estimated current of colours that are sent as they are. */
  uint32_t estimateMa(const Rgb* frame, uint16_t count) const;

  /** in and out must be two different buffers (the power limit reads in again). */
  PostResult process(const Rgb* in, Rgb* out, uint16_t count) const;

 private:
  PowerModel model_;
  float bright_ = 0.5f;
  uint16_t maxMa_ = 8000;
};

}  // namespace led
