#include "settings.h"

#include <cmath>
#include <cstdlib>
#include <sstream>

namespace sys {

namespace {

// Flash keys. ESP32 Preferences allows at most 15 characters in a key.
constexpr const char* kSsid = "wifi_ssid";
constexpr const char* kPass = "wifi_pass";
constexpr const char* kBackup = "backup_host";
// Preferences cannot list its keys, so the names of the calibration values are kept too.
constexpr const char* kCalKeys = "cal_keys";
constexpr size_t kMaxKey = 15;

std::string trim(const std::string& s) {
  const size_t a = s.find_first_not_of(" \t\r\n");
  if (a == std::string::npos) return "";
  const size_t b = s.find_last_not_of(" \t\r\n");
  return s.substr(a, b - a + 1);
}

bool validHost(const std::string& h) {
  if (h.empty() || h.size() > 64) return false;
  for (char c : h) {
    const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-';
    if (!ok) return false;
  }
  return true;
}

bool validCalName(const std::string& n) {
  if (n.empty() || n.size() > kMaxKey) return false;
  for (char c : n) {
    const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
    if (!ok) return false;
  }
  return n != kSsid && n != kPass && n != kBackup && n != kCalKeys;
}

}  // namespace

bool MemoryStore::getString(const char* key, std::string& out) const {
  const auto it = strings.find(key);
  if (it == strings.end()) return false;
  out = it->second;
  return true;
}

bool MemoryStore::getFloat(const char* key, float& out) const {
  const auto it = floats.find(key);
  if (it == floats.end()) return false;
  out = it->second;
  return true;
}

Settings loadSettings(const SettingsStore& store, const Settings& defaults) {
  Settings s = defaults;
  store.getString(kSsid, s.wifiSsid);
  store.getString(kPass, s.wifiPass);
  store.getString(kBackup, s.backupHost);
  std::string keys;
  if (store.getString(kCalKeys, keys)) {
    std::istringstream in(keys);
    std::string name;
    while (std::getline(in, name, ',')) {
      float v;
      if (!name.empty() && store.getFloat(name.c_str(), v)) s.cal[name] = v;
    }
  }
  return s;
}

void saveSettings(SettingsStore& store, const Settings& s) {
  store.putString(kSsid, s.wifiSsid);
  store.putString(kPass, s.wifiPass);
  store.putString(kBackup, s.backupHost);
  std::string keys;
  for (const auto& [name, value] : s.cal) {
    store.putFloat(name.c_str(), value);
    if (!keys.empty()) keys += ',';
    keys += name;
  }
  store.putString(kCalKeys, keys);
}

SettingsConsole::SettingsConsole(SettingsStore& store, const Settings& defaults)
    : store_(store), defaults_(defaults), current_(loadSettings(store, defaults)) {}

std::string SettingsConsole::handle(const std::string& rawLine, ConsoleAction& action) {
  action = ConsoleAction{};
  const std::string line = trim(rawLine);
  if (line.empty()) return "";
  const size_t sp = line.find(' ');
  const std::string cmd = line.substr(0, sp);
  const std::string rest = sp == std::string::npos ? "" : trim(line.substr(sp + 1));

  if (cmd == "show") return show();
  if (cmd == "set") {
    const size_t ksp = rest.find(' ');
    const std::string key = rest.substr(0, ksp);
    // The value is everything after the key, so a Wi-Fi name may have spaces.
    const std::string value = ksp == std::string::npos ? "" : rest.substr(ksp + 1);
    return set(key, value);
  }
  if (cmd == "save") {
    saveSettings(store_, current_);
    dirty_ = false;
    return "ok saved; `restart` to use the new Wi-Fi settings";
  }
  if (cmd == "reset") {
    store_.clear();
    current_ = defaults_;
    dirty_ = false;
    return "ok back to the built-in values";
  }
  if (cmd == "restart") {
    action.kind = ConsoleAction::Restart;
    return dirty_ ? "ok restarting (changes that were not saved are lost)" : "ok restarting";
  }
  if (cmd == "test") {
    std::istringstream in(rest);
    std::string name;
    int arg = 0;
    in >> name >> arg;
    if (name.empty()) return "error: test <off|pieces|chase|segment|white> [segment]";
    action.kind = ConsoleAction::TestPattern;
    action.pattern = name;
    action.arg = arg;
    return "ok test " + name;
  }
  return "error: unknown command `" + cmd + "`; commands: show, set, save, reset, test, restart";
}

std::string SettingsConsole::set(const std::string& key, const std::string& value) {
  if (key == kSsid) {
    if (value.empty() || value.size() > 32) return "error: wifi_ssid must be 1-32 characters";
    current_.wifiSsid = value;
  } else if (key == kPass) {
    if (!value.empty() && (value.size() < 8 || value.size() > 63)) return "error: wifi_pass must be empty or 8-63 characters";
    current_.wifiPass = value;
  } else if (key == kBackup) {
    if (!validHost(value)) return "error: backup_host must be an IPv4 address or a host name";
    current_.backupHost = value;
  } else if (key.rfind("cal.", 0) == 0) {
    const std::string name = key.substr(4);
    if (!validCalName(name)) return "error: calibration name must be 1-15 letters, digits or _";
    char* end = nullptr;
    const float v = std::strtof(value.c_str(), &end);
    if (value.empty() || end == nullptr || *end != '\0' || !std::isfinite(v)) return "error: calibration value must be a number";
    current_.cal[name] = v;
  } else {
    return "error: unknown setting `" + key + "`";
  }
  dirty_ = true;
  return "ok " + key + " (not saved yet: `save`)";
}

std::string SettingsConsole::show() const {
  std::ostringstream o;
  o << "wifi_ssid   " << current_.wifiSsid << "\n";
  o << "wifi_pass   " << (current_.wifiPass.empty() ? "(none)" : "********") << "\n";
  o << "backup_host " << current_.backupHost << "\n";
  for (const auto& [name, value] : current_.cal) o << "cal." << name << " " << value << "\n";
  o << (dirty_ ? "(changed, not saved)" : "(saved)");
  return o.str();
}

}  // namespace sys
