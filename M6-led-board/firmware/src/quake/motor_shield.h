// M6-2 motor output for the bought motor shield (2 × L293D + 74HC595, "motor shield v1").
// Wiring and pins: M6-led-board/hardware/pins_and_power.md, "Motors".
//
//  - Each motor has its own speed pin. Its PWM duty is the motor's strength (0 = off).
//  - The direction inputs of the L293D are set by the 74HC595. A vibration motor needs no
//    direction, so begin() sends one byte (0x27, all four "forward") and it never changes.
//
// The pin calls are behind ShieldPins, so this file stays plain C++ and runs in the PC tests.
// On the ESP32 the pins are shield_pins_arduino.h.
#pragma once
#include <cstdint>

#include "motor_controller.h"

namespace quake {

// pins_and_power.md, "Proposed constants for the firmware".
constexpr int PIN_MOTOR[kMotorCount] = {32, 33, 25, 26};  // M1..M4 = zone 0, 2, 6, 8 = mask bit 0..3
constexpr int PIN_SR_LATCH = 27;                          // shield pin 12
constexpr int PIN_SR_CLOCK = 14;                          // shield pin 4
constexpr int PIN_SR_DATA = 13;                           // shield pin 8 (shield pin 7 to GND)

// 74HC595 bits of the shield: M1 A=2 B=3, M2 A=1 B=4, M3 A=5 B=7, M4 A=0 B=6.
// Forward = A on, B off: bits 2, 1, 5, 0.
constexpr uint8_t kShieldForward = 0x27;

struct ShieldPwm {
  uint32_t hz = 1000;  // PWM frequency of the speed pins
  uint8_t bits = 8;    // PWM resolution: duty 1 = 2^bits - 1
};

// The few pin calls the shield needs.
class ShieldPins {
 public:
  virtual ~ShieldPins() = default;
  virtual void output(int pin) = 0;               // make the pin an output
  virtual void write(int pin, bool high) = 0;     // set it low or high
  virtual bool pwmAttach(int pin, uint32_t hz, uint8_t bits) = 0;
  virtual void pwmWrite(int pin, uint32_t value) = 0;
};

class MotorShield : public MotorOutput {
 public:
  explicit MotorShield(ShieldPins& pins, const ShieldPwm& pwm = {}) : pins_(pins), pwm_(pwm) {}

  // Call first in setup(): speed pins low, direction byte, then PWM at 0 on all motors.
  // Returns false if a PWM pin could not start; that motor then stays off.
  bool begin();

  // Duty 0 to 1. Before begin() nothing is written to the pins.
  void setDuty(int motor, float duty) override;

  bool ready() const { return ready_; }
  uint32_t maxValue() const { return (1u << pwm_.bits) - 1; }
  uint32_t value(int motor) const { return motor >= 0 && motor < kMotorCount ? value_[motor] : 0; }

 private:
  void shiftOut(uint8_t bits);

  ShieldPins& pins_;
  ShieldPwm pwm_;
  bool ready_ = false;
  bool pwmOk_[kMotorCount] = {false, false, false, false};
  uint32_t value_[kMotorCount] = {0, 0, 0, 0};
};

}  // namespace quake
