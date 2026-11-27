// Step 4 of the main loop, second half (plan #28 section 3.1): the mixed frame of M6-4
// is post processed and sent to the strips, and the frame report is kept up to date.
//
//   M6-4 draws `Frame mixed`  →  outputStage.send(mixed, millis())
//
// While a test pattern is on, the pattern is sent instead of the mixed frame.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "../sys/frame_stats.h"
#include "led_map.h"
#include "post_process.h"
#include "strip_output.h"
#include "test_pattern.h"

namespace led {

class OutputStage {
 public:
  OutputStage(StripOutput& out, const PowerModel& model = PowerModel{});

  /** Starts the strip driver. On failure the stage keeps running and reports an error. */
  bool begin();

  /** From the config of the server (`bright`, `max_ma`). */
  void setConfig(float bright, uint16_t maxMa) { post_.setConfig(bright, maxMa); }

  /** A test pattern from the USB cable; Pattern::None goes back to the game. */
  void setPattern(Pattern p, uint32_t nowMs, uint8_t arg = 0);
  Pattern pattern() const { return pattern_; }

  /** Post processes and sends one frame. */
  PostResult send(const Frame& mixed, uint32_t nowMs);

  /** For the status report (board_protocol.md `T`): `fps`, `ma_est`, `err`. */
  uint16_t fps() const { return stats_.fps(); }
  uint32_t maEst() const { return stats_.maEst(); }
  /** Error names of the LED part. Empty when all is well. */
  std::vector<std::string> errors(uint32_t nowMs);

  const Frame& lastSent() const { return sent_; }

 private:
  StripOutput& out_;
  PostProcessor post_;
  sys::FrameStats stats_;
  Frame patternFrame_{};
  Frame sent_{};
  Pattern pattern_ = Pattern::None;
  uint8_t patternArg_ = 0;
  uint32_t patternStart_ = 0;
  bool driverOk_ = false;
};

}  // namespace led
