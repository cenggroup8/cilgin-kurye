// Board settings (M6-3, plan #28 section 3.2 "Ayarlar"): Wi-Fi name and password, the
// backup server address and the calibration values. They live in flash and can be changed
// over the USB cable, so a new place needs no new build (#54: "Wi-Fi adı kodu yeniden
// derlemeden değiştirilir").
//
// USB commands, one per line (115200 baud, the serial monitor of PlatformIO):
//   show                       all settings (the password is hidden)
//   set wifi_ssid <name>       up to 32 characters, spaces allowed
//   set wifi_pass <password>   empty or 8–63 characters
//   set backup_host <address>  IPv4 address or host name of the backup server
//   set cal.<name> <number>    a calibration value of M6-2 (for example cal.noiseFactor)
//   save                       write to flash; the new Wi-Fi is used after `restart`
//   reset                      back to the values of secrets.h
//   test <pattern> [segment]   LED test pattern: off, pieces, chase, segment, white
//   restart
#pragma once
#include <cstdint>
#include <map>
#include <string>

namespace sys {

/**
 * Flash storage of the board. On the ESP32 it is `Preferences` (settings_nvs.h); in the tests
 * a map. M6-2's `quake::SettingsStore` (#60) asks for getFloat and putFloat, which this has.
 */
class SettingsStore {
 public:
  virtual ~SettingsStore() = default;
  virtual bool getString(const char* key, std::string& out) const = 0;
  virtual void putString(const char* key, const std::string& value) = 0;
  virtual bool getFloat(const char* key, float& out) const = 0;
  virtual void putFloat(const char* key, float value) = 0;
  virtual void clear() = 0;
};

class MemoryStore : public SettingsStore {
 public:
  bool getString(const char* key, std::string& out) const override;
  void putString(const char* key, const std::string& value) override { strings[key] = value; }
  bool getFloat(const char* key, float& out) const override;
  void putFloat(const char* key, float value) override { floats[key] = value; }
  void clear() override {
    strings.clear();
    floats.clear();
  }
  std::map<std::string, std::string> strings;
  std::map<std::string, float> floats;
};

struct Settings {
  std::string wifiSsid;
  std::string wifiPass;
  std::string backupHost;
  std::map<std::string, float> cal;  // name without "cal."
};

/** Reads the store; values that are not there keep the defaults (from secrets.h). */
Settings loadSettings(const SettingsStore& store, const Settings& defaults);
void saveSettings(SettingsStore& store, const Settings& s);

/** What a command line asks the rest of the program to do. */
struct ConsoleAction {
  enum Kind : uint8_t { None, Restart, TestPattern } kind = None;
  std::string pattern;  // for TestPattern
  int arg = 0;
};

/**
 * The USB console. `handle()` takes one line and returns the answer to print.
 * Changes are kept in memory until `save`.
 */
class SettingsConsole {
 public:
  SettingsConsole(SettingsStore& store, const Settings& defaults);

  std::string handle(const std::string& line, ConsoleAction& action);

  const Settings& settings() const { return current_; }
  /** The settings were changed since the last save. */
  bool dirty() const { return dirty_; }

 private:
  std::string set(const std::string& key, const std::string& value);
  std::string show() const;

  SettingsStore& store_;
  Settings defaults_;
  Settings current_;
  bool dirty_ = false;
};

}  // namespace sys
