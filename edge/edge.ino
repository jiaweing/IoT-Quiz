#include <M5StickCPlus.h>
#include <WiFi.h>
#include <PubSubClient.h>

// WiFi credentials
const char* ssid = "SINGTEL-Y9KC";     // Replace with your WiFi SSID
const char* password = "XXXXXXXX";   // Replace with your WiFi password

// MQTT Broker settings
const char* mqtt_server = "192.168.1.242"; // Replace with your server IP
const int mqtt_port = 1883;  // Standard MQTT port instead of WebSocket
const char* mqtt_client_id = "m5stick_sensor";
const char* mqtt_topic = "sensor/accelerometer";
const char* mqtt_status_topic = "sensor/status";

WiFiClient espClient;
PubSubClient client(espClient);
unsigned long lastMsg = 0;
float accX = 0;
float accY = 0;
float accZ = 0;

void clearLine(int line) {
  int yPos = line * 12;
  M5.Lcd.fillRect(0, yPos, 135, 12, BLACK);
  M5.Lcd.setCursor(0, yPos);
}

void logMessage(const char* msg, int line) {
  clearLine(line);
  M5.Lcd.setCursor(0, line * 12);
  M5.Lcd.print(msg);
}

// Callback for received messages
void callback(char* topic, byte* payload, unsigned int length) {
  // Create a buffer for the message
  char message[50];
  memcpy(message, payload, min(length, sizeof(message) - 1));
  message[min(length, sizeof(message) - 1)] = '\0';
  
  // Display received message
  if (strcmp(topic, mqtt_status_topic) == 0) {
    logMessage(message, 3); // Display on line 3
    M5.Lcd.fillRect(120, 0, 15, 15, BLUE); // Show blue indicator for received message
    delay(100); // Brief delay
    M5.Lcd.fillRect(120, 0, 15, 15, GREEN); // Return to green
  }
}

void setup_wifi() {
  WiFi.begin(ssid, password);
  
  int dots = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    clearLine(0);
    M5.Lcd.print("WiFi");
    for(int i = 0; i < dots; i++) M5.Lcd.print(".");
    dots = (dots + 1) % 4;
  }

  logMessage("WiFi OK!", 0);
  logMessage(WiFi.localIP().toString().c_str(), 1);
}

void reconnect() {
  int attempts = 0;
  while (!client.connected()) {
    attempts++;
    logMessage("MQTT connecting...", 2);
    
    if (client.connect(mqtt_client_id)) {
      logMessage("MQTT OK!", 2);
      // Subscribe to status topic
      client.subscribe(mqtt_status_topic);
      break;
    } else {
      char buf[32];
      snprintf(buf, sizeof(buf), "MQTT:%d", client.state());
      logMessage(buf, 2);
      delay(2000);
    }
  }
}

void setup() {
  M5.begin();
  M5.Imu.Init();
  M5.Lcd.setRotation(3);
  M5.Lcd.fillScreen(BLACK);
  M5.Lcd.setTextSize(1);
  
  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback); // Set the message callback
  
  // Set larger buffer for MQTT messages
  client.setBufferSize(512);
  // Increase keep alive interval
  client.setKeepAlive(60);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  unsigned long now = millis();
  if (now - lastMsg > 1000) {
    lastMsg = now;
    
    M5.IMU.getAccelData(&accX, &accY, &accZ);
    
    // Create JSON string with sensor data
    char msg[64];
    snprintf(msg, sizeof(msg), "{\"x\":%.1f,\"y\":%.1f,\"z\":%.1f}", accX, accY, accZ);
    
    // Try to publish
    if (client.connected()) {
      if (client.publish(mqtt_topic, msg)) {
        // Update display with latest values and success indicator
        clearLine(4);
        clearLine(5);
        M5.Lcd.setCursor(0, 48);
        M5.Lcd.printf("X:%.1f Y:%.1f", accX, accY);
        M5.Lcd.setCursor(0, 60);
        M5.Lcd.printf("Z:%.1f", accZ);
        
        // Show success indicator
        M5.Lcd.fillRect(120, 0, 15, 15, GREEN);
      } else {
        logMessage("Pub failed", 4);
        // Show failure indicator
        M5.Lcd.fillRect(120, 0, 15, 15, RED);
      }
    }
  }
  
  M5.update();
}