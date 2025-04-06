#include <M5StickCPlus.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "config.h"

// Create a Preferences object to store and retrieve credentials
Preferences preferences;

void setup() {
  M5.begin();
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n\n===== M5StickC Plus Device Registration =====");
  M5.Lcd.setRotation(3);
  M5.Lcd.fillScreen(BLACK);
  M5.Lcd.setTextSize(1);
  
  // Initialize preferences in non-readonly mode (so we can write credentials)
  preferences.begin("mqtt-creds", false);
  
  // Load WiFi configuration
  loadConfig();
  
  // Connect to WiFi
  M5.Lcd.setCursor(0, 0);
  M5.Lcd.print("Connecting to WiFi...");
  Serial.printf("Connecting to WiFi: %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    M5.Lcd.print(".");
    attempts++;
  }
  
  if (WiFi.status() != WL_CONNECTED) {
    M5.Lcd.setCursor(0, 12);
    M5.Lcd.print("WiFi connection failed!");
    Serial.println("\nWiFi connection failed!");
    while(1) { delay(1000); }
  }
  
  M5.Lcd.setCursor(0, 12);
  M5.Lcd.print("WiFi connected!");
  Serial.printf("\nWiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());
  
  // Get MAC address without colons
  String rawMacAddress = WiFi.macAddress();
  String macAddress = "";
  
  // Remove colons from MAC address
  for (int i = 0; i < rawMacAddress.length(); i++) {
    if (rawMacAddress[i] != ':') {
      macAddress += rawMacAddress[i];
    }
  }
  
  M5.Lcd.setCursor(0, 24);
  M5.Lcd.print("MAC: ");
  M5.Lcd.print(macAddress);
  Serial.print("MAC Address (raw): ");
  Serial.println(rawMacAddress);
  Serial.print("MAC Address (formatted): ");
  Serial.println(macAddress);
  
  // Generate a random password
  String password = "Pass" + String(random(10000, 99999));
  
  // Register with server using HTTPS
  registerDevice(macAddress, PLAYER_NAME, password);
}

//
// Function: registerDevice
// Description: Sends an HTTPS POST request to register the device on the server
//
void registerDevice(String macAddress, String playerName, String password) {
  M5.Lcd.setCursor(0, 36);
  M5.Lcd.print("Registering device...");
  
  String serverUrl = "https://";
  serverUrl += MQTT_SERVER;
  serverUrl += ":3001/api/register-device";
  
  Serial.print("Connecting to: ");
  Serial.println(serverUrl);
  
  // Create a secure WiFi client that ignores certificate validation
  WiFiClientSecure secureClient;
  secureClient.setInsecure(); // Skip certificate validation
  
  HTTPClient http;
  bool beginSuccess = http.begin(secureClient, serverUrl);
  
  if (!beginSuccess) {
    Serial.println("HTTPS setup failed!");
    M5.Lcd.setCursor(0, 48);
    M5.Lcd.print("HTTPS setup failed!");
    return;
  }
  
  http.addHeader("Content-Type", "application/json");
  
  // Create JSON payload - explicitly convert to strings to avoid 'any' type errors
  StaticJsonDocument<256> doc;
  doc["macAddress"] = String(macAddress);
  doc["playerName"] = String(playerName);
  doc["password"] = String(password);
  
  String payload;
  serializeJson(doc, payload);
  
  Serial.print("Sending payload: ");
  Serial.println(payload);
  
  int httpCode = http.POST(payload);
  String response = http.getString();
  
  Serial.print("HTTP Response code: ");
  Serial.println(httpCode);
  Serial.print("Response: ");
  Serial.println(response);
  
  // If registration was successful, parse the response and save credentials
  if (httpCode == HTTP_CODE_OK) {
    // Parse the response
    StaticJsonDocument<256> respDoc;
    DeserializationError error = deserializeJson(respDoc, response);
    
    if (!error && respDoc["success"]) {
      // Use the server-provided password if available
      String serverPassword = respDoc.containsKey("password") ?
        respDoc["password"].as<String>() : password;
      
      // Save credentials to preferences
      preferences.putString("macAddress", macAddress);
      preferences.putString("password", serverPassword);
      
      M5.Lcd.fillScreen(BLACK);
      M5.Lcd.setCursor(0, 0);
      M5.Lcd.print("Registration success!");
      M5.Lcd.setCursor(0, 12);
      M5.Lcd.print("Saved credentials:");
      M5.Lcd.setCursor(0, 24);
      M5.Lcd.print("MAC: " + macAddress);
      M5.Lcd.setCursor(0, 36);
      M5.Lcd.print("PWD: " + serverPassword);
      M5.Lcd.setCursor(0, 48);
      M5.Lcd.print("Press A to continue");
      
      Serial.println("Device registered successfully!");
      Serial.println("MAC: " + macAddress);
      Serial.println("Password: " + serverPassword);
    } else {
      // If registration failed, save default credentials (for testing)
      saveDefaultCredentials(macAddress, password);
    }
  } else {
    // If HTTP POST fails, save default credentials for testing purposes
    saveDefaultCredentials(macAddress, password);
  }
  
  http.end();
}

//
// Function: saveDefaultCredentials
// Description: Saves the provided MAC address and password as default credentials in case of registration failure
//
void saveDefaultCredentials(String macAddress, String password) {
  preferences.putString("macAddress", macAddress);
  preferences.putString("password", password);
  
  M5.Lcd.fillScreen(BLACK);
  M5.Lcd.setCursor(0, 0);
  M5.Lcd.print("Registration failed!");
  M5.Lcd.setCursor(0, 12);
  M5.Lcd.print("Saving default creds:");
  M5.Lcd.setCursor(0, 24);
  M5.Lcd.print("MAC: " + macAddress);
  M5.Lcd.setCursor(0, 36);
  M5.Lcd.print("PWD: " + password);
  M5.Lcd.setCursor(0, 48);
  M5.Lcd.print("Press A to continue");
  
  Serial.println("Registration failed. Saving default credentials:");
  Serial.println("MAC: " + macAddress);
  Serial.println("Password: " + password);
}
  
void loop() {
  M5.update();

  // When button A is pressed, display the saved credentials and registration complete message.
  if (M5.BtnA.wasPressed()) {
    M5.Lcd.fillScreen(BLACK);
    M5.Lcd.setCursor(0, 0);
    M5.Lcd.println("Registration complete.");
    M5.Lcd.setCursor(0, 12);
    M5.Lcd.println("Saved credentials:");
    
    String savedMac = preferences.getString("macAddress", "Not found");
    String savedPwd = preferences.getString("password", "Not found");
    
    M5.Lcd.setCursor(0, 24);
    M5.Lcd.print("MAC: ");
    M5.Lcd.println(savedMac);
    M5.Lcd.setCursor(0, 36);
    M5.Lcd.print("PWD: ");
    M5.Lcd.println(savedPwd);
    M5.Lcd.setCursor(0, 48);
    M5.Lcd.println("Restart to use the");
    M5.Lcd.setCursor(0, 60);
    M5.Lcd.println("main quiz app.");
    
    Serial.println("Credentials verified:");
    Serial.println("MAC: " + savedMac);
    Serial.println("Password: " + savedPwd);
  }
  
  delay(100);
}