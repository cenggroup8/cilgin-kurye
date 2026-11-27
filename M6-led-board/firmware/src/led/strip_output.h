// The place where colours leave the program for the two LED strips (M6-3).
//
// The driver that really sends the WS2812B signal is not here yet: the LED library is
// not chosen in the project documents (#54). Whatever it is, it must send chain A on
// GPIO16 and chain B on GPIO17 at the same time (two RMT channels, pins_and_power.md),
// so one frame of 728 LEDs takes about 11 ms and 60 frames per second fit.
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
