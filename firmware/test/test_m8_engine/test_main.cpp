// Native unit tests for the M8 engine skeleton. Run: pio test -d firmware -e native
#include <unity.h>
#include "led_engine.h"

using namespace m8;

static Rgb frame[kLedCount];

void setUp() {}
void tearDown() {}

void test_render_is_deterministic() {
  Rgb a[kLedCount], b[kLedCount];
  setLinkStatus(LinkStatus::Searching);
  render(1234, a);
  render(1234, b);
  for (int i = 0; i < kLedCount; ++i) {
    TEST_ASSERT_EQUAL_UINT8(a[i].r, b[i].r);
    TEST_ASSERT_EQUAL_UINT8(a[i].g, b[i].g);
    TEST_ASSERT_EQUAL_UINT8(a[i].b, b[i].b);
  }
}

void test_connected_empty_state_is_dark() {
  setLinkStatus(LinkStatus::Connected);
  applyState(BoardState{});
  render(0, frame);
  TEST_ASSERT_EQUAL_UINT32(kLedCount, estimateMilliamps(frame, kLedCount));  // idle current only
}

void test_current_estimate_full_white() {
  for (int i = 0; i < kLedCount; ++i) frame[i] = {255, 255, 255};
  // 344 LEDs x (60 mA + 1 mA idle) = 20984 mA
  TEST_ASSERT_EQUAL_UINT32(20984, estimateMilliamps(frame, kLedCount));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_render_is_deterministic);
  RUN_TEST(test_connected_empty_state_is_dark);
  RUN_TEST(test_current_estimate_full_white);
  return UNITY_END();
}
