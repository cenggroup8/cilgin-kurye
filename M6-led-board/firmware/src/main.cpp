// Board program: one program, one main loop (M6 plan #28, section 3.1).
// The order of the steps is fixed and no step waits: at 60 frames per second
// one round is about 16 ms, and a waiting call would stop all LEDs.
//
// M6-1 owns this skeleton. The other packages plug in where their step is.

#include <Arduino.h>
#include <WiFi.h>

#include "led/board_renderer.h"
#include "led/demo_mode.h"
#include "link/link.h"
#include "link/net_arduino.h"

#if __has_include("secrets.h")
#include "secrets.h"  // Wi-Fi name and password, backup server address (not in git)
#else
#include "secrets.example.h"
#endif

namespace {

constexpr const char* kFirmware = "0.1.0";

boardlink::ArduinoNet net;
boardlink::Link* boardLink = nullptr;

uint32_t lastStatusMs = 0;
uint32_t usedStateVersion = 0;
uint32_t usedConfigVersion = 0;

// M6-4: drawing. Build with -DM6_DEMO=1 for the demo mode (a whole game with no server).
#ifndef M6_DEMO
#define M6_DEMO 0
#endif
led::BoardRenderer renderer;
led::DemoMode demo;
led::Frame frame;

}  // namespace

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);  // does not wait; the link waits for ready()

  boardlink::LinkSettings s;
  s.backupHost = BACKUP_SERVER;
  s.fw = kFirmware;
  static boardlink::Link link(net, s);
  boardLink = &link;

  // M6-2: sensor and motor setup.
  // M6-3: LED strips and settings.
}

void loop() {
  const uint32_t now = millis();
  boardlink::Link& link = *boardLink;

  // 1. Network: read everything that came, answer at once (M6-1).
  link.poll(now);
  const bool connected = link.linkState() == boardlink::LinkState::Connected;

  // 2. Sensor and hit detector (M6-2). An event goes out with link.sendQuake(),
  //    the sensor groups with link.sendSensor().

  // 3. Motors (M6-2). New commands come from link.takeVibrate().
  //    While the link is not connected the motors must stop at once.
  boardlink::VibrateCmd cmd;
  while (link.takeVibrate(cmd)) {
    // M6-2: motorController.start(cmd)
  }
  (void)connected;  // M6-2: if (!connected) motorController.stopAll();

  // 4. One LED frame (M6-4 draws, M6-3 sends to the strips).
  //    The LED part reads only: link.latestState(), link.config(), link.linkState().
  if (M6_DEMO) {
    const led::DemoFrame d = demo.step(now);
    if (d.newState) renderer.onState(d.state, now);
    renderer.setWinners(d.winners);
    renderer.draw(frame, now, link.config(), d.link);
  } else {
    if (link.stateVersion() != usedStateVersion) {
      usedStateVersion = link.stateVersion();
      renderer.onState(link.latestState(), now);
    }
    renderer.draw(frame, now, link.config(), link.linkState());
  }
  if (link.configVersion() != usedConfigVersion) usedConfigVersion = link.configVersion();
  // M6-3: outputStage.send(frame, now);

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
