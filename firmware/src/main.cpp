// Çılgın Kurye board firmware - entry point.
// Core 0: Wi-Fi, board protocol, IMU, motors (M7).  Core 1: LED engine (M8).
// See docs/ and the M7 / M8 module proposals. This is the skeleton: tasks start,
// the LED engine renders, nothing is sent to the strips or the network yet.
#include <Arduino.h>
#include "led_engine.h"

static constexpr const char* kFirmwareVersion = "0.0.1";
static m8::Rgb frameBuffer[m8::kLedCount];

static void renderTask(void*) {
  const TickType_t period = pdMS_TO_TICKS(16);  // about 60 fps
  TickType_t last = xTaskGetTickCount();
  for (;;) {
    m8::render(millis(), frameBuffer);
    // TODO(M8): send frameBuffer to the 5 LED channels (RMT/DMA driver).
    vTaskDelayUntil(&last, period);
  }
}

void setup() {
  Serial.begin(115200);
  Serial.printf("Cilgin Kurye board firmware %s\n", kFirmwareVersion);
  m8::setLinkStatus(m8::LinkStatus::Searching);
  // TODO(M7): Wi-Fi, UDP board link, IMU task, motor task (M7 proposal, Section 6).
  xTaskCreatePinnedToCore(renderTask, "render", 4096, nullptr, configMAX_PRIORITIES - 1, nullptr, 1);
}

void loop() {
  static uint32_t lastReport = 0;
  if (millis() - lastReport >= 1000) {
    lastReport = millis();
    Serial.printf("est. LED current: %u mA\n",
                  static_cast<unsigned>(m8::estimateMilliamps(frameBuffer, m8::kLedCount)));
  }
  delay(10);
}
