// Frame report of the LED part (M6-3): frames per second and the power estimate,
// for the status report that the link sends once per second (board_protocol.md `T`).
#pragma once
#include <cstdint>

namespace sys {

class FrameStats {
 public:
  /** One frame was sent at `nowMs`, with this current estimate. */
  void frame(uint32_t nowMs, uint32_t maEst, bool limited) {
    if (!started_) {
      started_ = true;
      windowStart_ = nowMs;
    }
    count_++;
    maEst_ = maEst;
    if (limited) limitedInWindow_ = true;
    roll(nowMs);
  }

  /** Call when no frame was sent, so a stopped LED part shows 0 frames per second. */
  void tick(uint32_t nowMs) {
    if (started_) roll(nowMs);
  }

  /** Frames in the last full second. */
  uint16_t fps() const { return fps_; }
  uint32_t maEst() const { return maEst_; }
  /** The power limit dimmed at least one frame in the last full second. */
  bool limited() const { return limited_; }

 private:
  void roll(uint32_t nowMs) {
    const uint32_t gone = nowMs - windowStart_;
    if (gone < 1000) return;
    fps_ = gone < 2000 ? count_ : 0;
    limited_ = limitedInWindow_;
    count_ = 0;
    limitedInWindow_ = false;
    windowStart_ = nowMs - gone % 1000;
  }

  bool started_ = false;
  uint32_t windowStart_ = 0;
  uint16_t count_ = 0;
  uint16_t fps_ = 0;
  uint32_t maEst_ = 0;
  bool limitedInWindow_ = false;
  bool limited_ = false;
};

}  // namespace sys
