// M6-2 motion sensor driver: MPU-6050 (GY-521 board) on I2C, address 0x68.
// Wiring: SDA GPIO21, SCL GPIO22, 3V3 (M6-led-board/hardware/pins_and_power.md).
//
//  - begin(): wakes the sensor, sets 200 samples per second, the ranges and its own filter.
//  - read(): one reading of the 6 values (14 bytes at once), in g and degrees per second.
//    The axes are the sensor's own; the hit detector turns them to the board (flipX, flipY,
//    swapXY in QuakeCalibration).
//  - When the sensor does not answer, read() gives false and tries begin() again about once a
//    second. The rest of the program goes on.
//
// The I2C calls are behind I2cBus, so this file stays plain C++ and runs in the PC tests.
// On the ESP32 the bus is i2c_arduino.h.
#pragma once
#include <cstdint>

#include "quake_unit.h"

namespace quake {

constexpr int PIN_IMU_SDA = 21;
constexpr int PIN_IMU_SCL = 22;
constexpr uint8_t kMpuAddress = 0x68;

// The few I2C calls the sensor needs. Both return false when the sensor does not answer.
class I2cBus {
 public:
  virtual ~I2cBus() = default;
  virtual bool writeReg(uint8_t addr, uint8_t reg, uint8_t value) = 0;
  virtual bool readRegs(uint8_t addr, uint8_t reg, uint8_t* out, int count) = 0;
};

namespace mpu {
// Registers (MPU-6000/6050 register map).
constexpr uint8_t kSampleRateDiv = 0x19;
constexpr uint8_t kConfig = 0x1A;
constexpr uint8_t kGyroConfig = 0x1B;
constexpr uint8_t kAccelConfig = 0x1C;
constexpr uint8_t kAccelOut = 0x3B;  // 14 bytes: accel x y z, temperature, gyro x y z
constexpr uint8_t kPowerMgmt1 = 0x6B;
constexpr uint8_t kWhoAmI = 0x75;
}  // namespace mpu

struct MpuSettings {
  // Sample rate = 1000 Hz / (1 + div) while the filter is on: 4 -> 200 Hz, as the detector reads.
  uint8_t sampleRateDiv = 4;
  // Sensor's own filter: 2 = about 94 Hz, just under half of 200 Hz, so a short hit keeps its peak.
  uint8_t filter = 2;
  // Accelerometer range: 3 = ±16 g. A hard hit does not clip (strength 10 is about 11 g).
  uint8_t accelRange = 3;
  // Gyroscope range: 1 = ±500 degrees per second.
  uint8_t gyroRange = 1;
  // Failed reads in a row before the sensor counts as lost, and between two tries of begin().
  int retryAfter = 200;  // 1 s at 200 Hz
};

class Mpu6050 : public MotionSensor {
 public:
  explicit Mpu6050(I2cBus& bus, const MpuSettings& s = {}, uint8_t addr = kMpuAddress)
      : bus_(bus), s_(s), addr_(addr) {}

  // Returns false if no sensor answers or its id is not one we know.
  bool begin();

  // One reading. False if the sensor is lost or the read failed.
  bool read(ImuSample& out) override;

  bool ok() const { return ok_; }
  uint8_t whoAmI() const { return whoAmI_; }  // 0x68 on a real MPU-6050; 0 if no answer
  uint32_t failedReads() const { return failedReads_; }
  float gPerCount() const { return 1.0f / float(16384 >> (s_.accelRange & 3)); }
  float dpsPerCount() const { return 1.0f / (131.0f / float(1 << (s_.gyroRange & 3))); }

 private:
  I2cBus& bus_;
  MpuSettings s_;
  uint8_t addr_;
  bool ok_ = false;
  uint8_t whoAmI_ = 0;
  int failsInRow_ = 0;
  uint32_t failedReads_ = 0;
};

}  // namespace quake
