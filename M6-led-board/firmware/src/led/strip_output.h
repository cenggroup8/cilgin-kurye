// The place where colours leave the program for the two LED strips (M6-3).
//
// The driver that really sends the WS2812B signal is not here yet. The M6 team chose
// FastLED (NeoPixelBus if it causes trouble, #64). It must send chain A on GPIO16 and
// chain B on GPIO17 at the same time (two RMT channels, pins_and_power.md), so one frame
// of 788 LEDs (the longer chain has 398) takes about 12 ms and 60 frames per second fit.
// The PC tests use a fake output that keeps the last frame.
#pragma once
#include <cstdint>

#include "led_map.h"

namespace led {

constexpr int kPinChainA = 16;  // pins_and_power.md, "Proposed constants for the firmware"
constexpr int kPinChainB = 17;

class StripOutput {
 public:
  virtual ~StripOutput() = default;
  /** Prepares the two data pins. Returns false when the driver could not start. */
  virtual bool begin() = 0;
  /** Sends one frame. `chains[c]` holds `counts[c]` LEDs in chain order. Must not wait for the end. */
  virtual void show(const Rgb* const* chains, const uint16_t* counts, uint8_t chainCount) = 0;
};

}  // namespace led
