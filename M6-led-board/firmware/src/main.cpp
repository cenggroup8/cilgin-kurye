// Board program: one program, one main loop (M6 plan #28, section 3.1).
// The order of the steps is fixed and no step waits: at 60 frames per second
// one round is about 16 ms, and a waiting call would stop all LEDs.
//
// M6-1 owns this skeleton. The other packages plug in where their step is.

#include <Arduino.h>
#include <WiFi.h>

#include "link/link.h"
#include "link/net_arduino.h"
#include "quake/i2c_arduino.h"
#include "quake/motor_shield.h"
#include "quake/mpu6050.h"
#include "quake/quake_unit.h"
#include "quake/shield_pins_arduino.h"

#if __has_include("secrets.h")
#include "secrets.h"  // Wi-Fi name and password, backup server address (not in git)
#else
#include "secrets.example.h"
#endif

namespace {

constexpr const char* kFirmware = "0.1.0";

boardlink::ArduinoNet net;
boardlink::Link* boardLink = nullptr;

quake::ArduinoShieldPins shieldPins;
quake::MotorShield motorShield(shieldPins);
quake::ArduinoI2c imuBus;
quake::Mpu6050 imu(imuBus);
quake::QuakeUnit* quakeUnit = nullptr;  // made in setup(), after the shield

uint32_t lastStatusMs = 0;
uint32_t usedStateVersion = 0;
uint32_t usedConfigVersion = 0;

quake::VibrateCommand toCommand(const boardlink::VibrateCmd& v) {
  quake::VibrateCommand c;
  c.mask = v.mask;
  c.duty = v.duty;
  c.ms = v.ms;
  c.rampMs = v.rampMs;
  return c;
}

// Hit detector -> server. QuakeEvent and QuakeOut have the same fields (#60, M6-1).
void sendQuake(const quake::QuakeEvent& e, void*) {
  boardlink::QuakeOut q;
  q.id = e.id;
  q.motor = e.src == quake::Source::Motor;
  q.peakG = e.peakG;
  q.mag = e.mag;
  q.u = e.u;
  q.v = e.v;
  q.zone = e.zone;
  q.conf = e.conf;
  boardLink->sendQuake(q);
}

void sendSamples(int hz, const float* values, int count, void*) {
  boardLink->sendSensor(uint16_t(hz), values, size_t(count));
}

}  // namespace

void setup() {
  // First: the motor speed pins float until here and the shield may read that as "on".
  const bool shieldOk = motorShield.begin();

  Serial.begin(115200);
  if (!shieldOk) Serial.println("motor shield: a PWM pin did not start, that motor stays off");

  // Motion sensor. If it does not answer, the board runs without hit detection and the
  // driver tries again about once a second. Calibration: defaults until M6-3 loads the
  // settings (calibration.h keys).
  imuBus.begin();
  if (imu.begin()) Serial.printf("motion sensor: ok, id 0x%02X\n", imu.whoAmI());
  else Serial.printf("motion sensor: not found (id 0x%02X), will try again\n", imu.whoAmI());
  static quake::QuakeUnit unit(imu, motorShield);
  unit.onEvent(sendQuake, nullptr);
  unit.onSamples(sendSamples, nullptr);
  quakeUnit = &unit;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);  // does not wait; the link waits for ready()

  boardlink::LinkSettings s;
  s.backupHost = BACKUP_SERVER;
  s.fw = kFirmware;
  static boardlink::Link link(net, s);
  boardLink = &link;

  // M6-3: LED strips and settings.
}

void loop() {
  const uint32_t now = millis();
  boardlink::Link& link = *boardLink;

  // 1. Network: read everything that came, answer at once (M6-1).
  link.poll(now);
  const bool connected = link.linkState() == boardlink::LinkState::Connected;

  // 2 and 3. Sensor, hit detector and motors (M6-2). New vibrate commands come from
  //    link.takeVibrate(); a new one replaces the running one. The unit reads the sensor at
  //    200 Hz, sends events with link.sendQuake() and the graph groups with link.sendSensor().
  //    While the link is not connected the motors stop at once.
  boardlink::VibrateCmd cmd;
  while (link.takeVibrate(cmd)) quakeUnit->vibrate(toCommand(cmd), now);
  quakeUnit->loop(micros(), now, connected);

  // 4. One LED frame (M6-4 draws, M6-3 sends to the strips).
  //    The LED part reads only: link.latestState(), link.config(), link.linkState().
  if (link.stateVersion() != usedStateVersion) usedStateVersion = link.stateVersion();
  if (link.configVersion() != usedConfigVersion) usedConfigVersion = link.configVersion();

  // 5. Reports (M6-3 fills the status, M6-1 sends it).
  if (now - lastStatusMs >= 1000) {
    lastStatusMs = now;
    boardlink::StatusOut st;
    st.fw = kFirmware;
    st.rssi = static_cast<int16_t>(WiFi.RSSI());
    st.heap = ESP.getFreeHeap();
    link.sendStatus(st);
  }
}
