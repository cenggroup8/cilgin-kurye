// M6-2 sensor samples for the seismic graph ("N" message: {hz, a:[...]}).
// The detector runs faster than the graph needs, so each group of `step` samples
// becomes one value: the strongest one, so a short hit is never lost on the graph.
// Every `batchSize` values make one small group for the UDP stream.
#pragma once
#include <cstddef>

namespace quake {

template <size_t BatchSize = 10>
class SampleBatcher {
 public:
  // inHz: detector rate, outHz: graph rate (inHz must be a multiple of outHz).
  SampleBatcher(int inHz = 200, int outHz = 100) : outHz_(outHz), step_(inHz / outHz > 0 ? inHz / outHz : 1) {}

  // Add one shaking value (g). Returns true when a full group is ready.
  bool add(float shake) {
    if (inStep_ == 0 || shake > stepPeak_) stepPeak_ = shake;
    if (++inStep_ < step_) return false;
    inStep_ = 0;
    values_[count_++] = stepPeak_;
    return count_ == BatchSize;
  }

  int hz() const { return outHz_; }
  size_t size() const { return count_; }
  const float* values() const { return values_; }
  void clear() { count_ = 0; }

 private:
  int outHz_;
  int step_;
  int inStep_ = 0;
  float stepPeak_ = 0;
  float values_[BatchSize] = {};
  size_t count_ = 0;
};

}  // namespace quake
