// M6-2 fixed sample rate without waiting: the main loop asks due(micros()) and
// reads the sensor only when it says true. The next time is counted from the
// planned time, not from the late call, so the rate stays exact on average.
// If the loop was held up for long, the missed samples are skipped, not caught up.
#pragma once
#include <cstdint>

namespace quake {

class FixedRate {
 public:
  explicit FixedRate(uint32_t hz) : periodUs_(1000000u / hz) {}

  bool due(uint32_t nowUs) {
    if (!started_) {
      next_ = nowUs + periodUs_;
      started_ = true;
      return true;
    }
    if (int32_t(nowUs - next_) < 0) return false;  // works over the micros() wrap
    next_ += periodUs_;
    if (int32_t(nowUs - next_) >= int32_t(4 * periodUs_)) {
      skipped_ += (nowUs - next_) / periodUs_;
      next_ = nowUs + periodUs_;
    }
    return true;
  }

  uint32_t periodUs() const { return periodUs_; }
  uint32_t skipped() const { return skipped_; }

 private:
  uint32_t periodUs_;
  uint32_t next_ = 0;
  uint32_t skipped_ = 0;
  bool started_ = false;
};

}  // namespace quake
