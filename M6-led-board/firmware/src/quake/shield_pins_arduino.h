// The shield pins on the ESP32 (Arduino core 3.x). Only built for the board.
#pragma once
#ifdef ARDUINO
#include <Arduino.h>

#include "motor_shield.h"

namespace quake {

class ArduinoShieldPins : public ShieldPins {
 public:
  void output(int pin) override { pinMode(pin, OUTPUT); }
  void write(int pin, bool high) override { digitalWrite(pin, high ? HIGH : LOW); }
  bool pwmAttach(int pin, uint32_t hz, uint8_t bits) override { return ledcAttach(pin, hz, bits); }
  void pwmWrite(int pin, uint32_t value) override { ledcWrite(pin, value); }
};

}  // namespace quake
#endif
