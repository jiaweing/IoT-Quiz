#include "config.h"

const char* WIFI_SSID = nullptr;
const char* WIFI_PASSWORD = nullptr;
const char* MQTT_SERVER = nullptr;
const int MQTT_PORT = 1883;

void loadConfig() {
  WIFI_SSID = "SINGTEL-Y9KC";
  WIFI_PASSWORD = "68hnwb36dw";
  MQTT_SERVER = "192.168.1.37";
}
