// The sensor's I2C bus on the ESP32 (Arduino Wire). Only built for the board.
#pragma once
#ifdef ARDUINO
#include <Wire.h>

#include "mpu6050.h"

namespace quake {

class ArduinoI2c : public I2cBus {
 public:
  // 400 kHz: one reading of 14 bytes takes about 0.4 ms. A short timeout, so a loose wire
  // never stops the main loop for long.
  void begin(int sda = PIN_IMU_SDA, int scl = PIN_IMU_SCL, uint32_t hz = 400000) {
    Wire.begin(sda, scl, hz);
    Wire.setTimeOut(5);
  }

  bool writeReg(uint8_t addr, uint8_t reg, uint8_t value) override {
    Wire.beginTransmission(addr);
    Wire.write(reg);
    Wire.write(value);
    return Wire.endTransmission() == 0;
  }

  bool readRegs(uint8_t addr, uint8_t reg, uint8_t* out, int count) override {
    Wire.beginTransmission(addr);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(addr, size_t(count)) != size_t(count)) return false;
    for (int i = 0; i < count; i++) out[i] = uint8_t(Wire.read());
    return true;
  }
};

}  // namespace quake
#endif
