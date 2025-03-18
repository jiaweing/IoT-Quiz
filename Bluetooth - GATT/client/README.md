# M5StickC Plus Quiz Client

## Environment Setup

1. Copy the `.env.example` file to `.env`:

```bash
cp .env.example .env
```

2. Edit the `.env` file with your WiFi and MQTT settings:

```
WIFI_SSID=your_wifi_name
WIFI_PASSWORD=your_wifi_password
MQTT_SERVER=your_mqtt_server_ip
MQTT_PORT=1883
```

## Files

- `client.ino` - Main Arduino sketch file
- `config.h` - Header file declaring environment variables
- `config.cpp` - Implementation file that loads environment variables
- `.env` - Environment file containing your credentials (not committed to git)

## Building and Uploading

1. Open `client.ino` in the Arduino IDE
2. Make sure you have the following libraries installed:
   - M5StickCPlus
   - PubSubClient
   - ArduinoJson
3. Select "M5Stick-C" as your board
4. Connect your M5StickC Plus via USB
5. Click Upload
