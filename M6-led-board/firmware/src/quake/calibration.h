// M6-2 calibration values. They are kept in the board settings (flash) and can be
// changed over the USB cable, so the code does not need a new build at a new place.
#pragma once

namespace quake {

struct QuakeCalibration {
  // Strength scale: the standard hit gets strength 5; each doubling of the
  // shaking adds magPerDoubling, so very strong hits grow slowly.
  float standardPeakG = 2.0f;
  float magPerDoubling = 2.0f;

  // Start threshold: noiseFactor times the learned room noise, never below floorG.
  float noiseFactor = 6.0f;
  float floorG = 0.15f;

  // Zone: share of the sideways push for a hit at the edge of the board,
  // and how much the gyroscope counts next to the accelerometer for the side.
  float edgeShare = 0.6f;
  float gyroWeight = 0.5f;

  // How the sensor is mounted under the board.
  bool flipX = false;
  bool flipY = false;
  bool swapXY = false;
};

// The settings store of the board (M6-3) gives these two calls; on the ESP32 it
// is the flash "Preferences" storage, in the tests a map.
class SettingsStore {
 public:
  virtual ~SettingsStore() = default;
  virtual bool getFloat(const char* key, float& out) const = 0;
  virtual void putFloat(const char* key, float value) = 0;
};

void saveCalibration(SettingsStore& store, const QuakeCalibration& cal);
// Reads every value that is in the store; missing values keep their defaults.
QuakeCalibration loadCalibration(const SettingsStore& store);

}  // namespace quake
