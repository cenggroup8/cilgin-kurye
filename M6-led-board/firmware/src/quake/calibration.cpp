#include "calibration.h"

namespace quake {

namespace {
// Short keys: the ESP32 flash storage allows at most 15 characters.
struct Entry {
  const char* key;
  float QuakeCalibration::*field;
};
const Entry kFloats[] = {
    {"q_std_peak", &QuakeCalibration::standardPeakG},
    {"q_mag_dbl", &QuakeCalibration::magPerDoubling},
    {"q_noise_k", &QuakeCalibration::noiseFactor},
    {"q_floor", &QuakeCalibration::floorG},
    {"q_edge", &QuakeCalibration::edgeShare},
    {"q_gyro_w", &QuakeCalibration::gyroWeight},
};
struct Flag {
  const char* key;
  bool QuakeCalibration::*field;
};
const Flag kFlags[] = {
    {"q_flip_x", &QuakeCalibration::flipX},
    {"q_flip_y", &QuakeCalibration::flipY},
    {"q_swap_xy", &QuakeCalibration::swapXY},
};
}  // namespace

void saveCalibration(SettingsStore& store, const QuakeCalibration& cal) {
  for (const auto& e : kFloats) store.putFloat(e.key, cal.*(e.field));
  for (const auto& f : kFlags) store.putFloat(f.key, cal.*(f.field) ? 1.0f : 0.0f);
}

QuakeCalibration loadCalibration(const SettingsStore& store) {
  QuakeCalibration cal;
  float v;
  for (const auto& e : kFloats)
    if (store.getFloat(e.key, v)) cal.*(e.field) = v;
  for (const auto& f : kFlags)
    if (store.getFloat(f.key, v)) cal.*(f.field) = v > 0.5f;
  return cal;
}

}  // namespace quake
