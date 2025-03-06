#ifndef CONFIG_H
#define CONFIG_H

extern const char* WIFI_SSID;
extern const char* WIFI_PASSWORD;
extern const char* MQTT_SERVER;
extern const int MQTT_PORT;
extern const char* CA_CERT;

void loadConfig();

#endif
