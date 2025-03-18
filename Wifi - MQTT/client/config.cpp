#include "config.h"

const char* WIFI_SSID = nullptr;
const char* WIFI_PASSWORD = nullptr;
const char* MQTT_SERVER = nullptr;
const int MQTT_PORT = 8883;
const char* CA_CERT = R"EOF(= "-----BEGIN CERTIFICATE-----
xx
xx
xx
-----END CERTIFICATE-----)EOF";

void loadConfig() {
  WIFI_SSID = "xxxxx";
  WIFI_PASSWORD = "xxxxx";
  MQTT_SERVER = "xxx.xx.xx.x";
}
