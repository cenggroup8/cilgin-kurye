#include "mpu6050.h"

namespace quake {

namespace {

// Ids of the sensor. GY-521 boards are sold with the MPU-6050 (0x68) and sometimes with a
// look-alike that answers differently but has the same registers for what we read.
bool knownId(uint8_t id) { return id == 0x68 || id == 0x70 || id == 0x72 || id == 0x98; }

int16_t be16(const uint8_t* p) { return int16_t(uint16_t(p[0]) << 8 | p[1]); }

}  // namespace

bool Mpu6050::begin() {
  ok_ = false;
  failsInRow_ = 0;
  uint8_t id = 0;
  if (!bus_.readRegs(addr_, mpu::kWhoAmI, &id, 1)) {
    whoAmI_ = 0;
    return false;
  }
  whoAmI_ = id;
  if (!knownId(id)) return false;
  // Wake up, clock from the X gyroscope (steadier than the inner oscillator).
  const bool done = bus_.writeReg(addr_, mpu::kPowerMgmt1, 0x01) &&
                    bus_.writeReg(addr_, mpu::kSampleRateDiv, s_.sampleRateDiv) &&
                    bus_.writeReg(addr_, mpu::kConfig, uint8_t(s_.filter & 7)) &&
                    bus_.writeReg(addr_, mpu::kGyroConfig, uint8_t((s_.gyroRange & 3) << 3)) &&
                    bus_.writeReg(addr_, mpu::kAccelConfig, uint8_t((s_.accelRange & 3) << 3));
  ok_ = done;
  return ok_;
}

bool Mpu6050::read(ImuSample& out) {
  if (!ok_) {
    // Lost: try again about once a second, never every loop.
    if (++failsInRow_ < s_.retryAfter) return false;
    failsInRow_ = 0;
    if (!begin()) return false;
  }
  uint8_t b[14];
  if (!bus_.readRegs(addr_, mpu::kAccelOut, b, 14)) {
    failedReads_++;
    if (++failsInRow_ >= s_.retryAfter) {
      ok_ = false;
      failsInRow_ = 0;
    }
    return false;
  }
  failsInRow_ = 0;
  const float g = gPerCount(), d = dpsPerCount();
  out.ax = float(be16(b + 0)) * g;
  out.ay = float(be16(b + 2)) * g;
  out.az = float(be16(b + 4)) * g;
  // b + 6: temperature, not used.
  out.gx = float(be16(b + 8)) * d;
  out.gy = float(be16(b + 10)) * d;
  out.gz = float(be16(b + 12)) * d;
  return true;
}

}  // namespace quake
