// Board settings in the ESP32 flash, with `Preferences` of the Arduino core for ESP32
// (part of the core, no extra library). Only for the board build: the PC tests use MemoryStore.
#pragma once
#ifdef ARDUINO
#include <Preferences.h>

#include "settings.h"

namespace sys {

class NvsStore : public SettingsStore {
 public:
  /** Opens the namespace "board" in flash. Call once in setup(). */
  bool begin() { return prefs_.begin("board", false); }

  bool getString(const char* key, std::string& out) const override {
    if (!prefs().isKey(key)) return false;
    out = prefs().getString(key).c_str();
    return true;
  }
  void putString(const char* key, const std::string& value) override { prefs_.putString(key, value.c_str()); }
  bool getFloat(const char* key, float& out) const override {
    if (!prefs().isKey(key)) return false;
    out = prefs().getFloat(key);
    return true;
  }
  void putFloat(const char* key, float value) override { prefs_.putFloat(key, value); }
  void clear() override { prefs_.clear(); }

 private:
  // The getters of Preferences are not const.
  Preferences& prefs() const { return const_cast<Preferences&>(prefs_); }
  Preferences prefs_;
};

}  // namespace sys
#endif
