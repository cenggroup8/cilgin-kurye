#include "motor_shield.h"

#include <cmath>

namespace quake {

bool MotorShield::begin() {
  // 1. Speed pins low first: until now they float and the L293D may read that as "on".
  for (int i = 0; i < kMotorCount; i++) {
    pins_.output(PIN_MOTOR[i]);
    pins_.write(PIN_MOTOR[i], false);
  }
  // 2. Direction byte into the 74HC595.
  pins_.output(PIN_SR_LATCH);
  pins_.output(PIN_SR_CLOCK);
  pins_.output(PIN_SR_DATA);
  shiftOut(kShieldForward);
  // 3. PWM on the speed pins, all at 0.
  bool ok = true;
  for (int i = 0; i < kMotorCount; i++) {
    pwmOk_[i] = pins_.pwmAttach(PIN_MOTOR[i], pwm_.hz, pwm_.bits);
    if (pwmOk_[i]) pins_.pwmWrite(PIN_MOTOR[i], 0);
    value_[i] = 0;
    ok = ok && pwmOk_[i];
  }
  ready_ = true;
  return ok;
}

void MotorShield::setDuty(int motor, float duty) {
  if (motor < 0 || motor >= kMotorCount) return;
  if (!(duty > 0)) duty = 0;  // also NaN
  if (duty > 1) duty = 1;
  const uint32_t v = uint32_t(std::lround(duty * float(maxValue())));
  value_[motor] = v;
  if (ready_ && pwmOk_[motor]) pins_.pwmWrite(PIN_MOTOR[motor], v);
}

// Most significant bit first; the outputs change when the latch goes high.
void MotorShield::shiftOut(uint8_t bits) {
  pins_.write(PIN_SR_LATCH, false);
  for (int i = 7; i >= 0; i--) {
    pins_.write(PIN_SR_CLOCK, false);
    pins_.write(PIN_SR_DATA, (bits >> i) & 1);
    pins_.write(PIN_SR_CLOCK, true);
  }
  pins_.write(PIN_SR_LATCH, true);
}

}  // namespace quake
