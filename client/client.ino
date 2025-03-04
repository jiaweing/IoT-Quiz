#include <M5StickCPlus.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>  // Recommended for JSON parsing
#include <time.h>

// WiFi credentials
const char* ssid = "SINGTEL-xxxx";
const char* password = "xxxxxx";

// MQTT Broker settings
const char* mqtt_server = "192.168.x.xx"; // Replace with your server IP
const int mqtt_port = 1883;  // Standard MQTT port
const char* mqtt_client_count_topic = "system/client_count";

// MQTT topics
const char* quiz_response_topic = "quiz/response";
const char* quiz_join_topic = "quiz/session/join";
const char* quiz_question_topic = "quiz/question";
const char* quiz_question_closed_topic = "quiz/question/closed";
const char* quiz_session_start_topic = "quiz/session/start";
const char* time_sync_topic = "system/time/sync";

// Generate a random client ID
String getRandomClientId() {
  String id = "m5stick_";
  for (int i = 0; i < 4; i++) {
    id += String(random(0xF), HEX);
  }
  return id;
}
String mqtt_client_id = getRandomClientId();

// Global variable to store current session id (or name) received
String currentSessionId = "";

// Global variable to track last broadcast time
unsigned long lastBroadcastTime = 0;

// Global variable for time sync offset (in milliseconds)
unsigned long long timeOffset = 0;

bool questionActive = false;  // Track whether a question is open

WiFiClient espClient;
PubSubClient client(espClient);

// Arrays to hold option IDs and texts
String optionIds[4];     
String optionTexts[4];    

// Variables for option selection
int totalOptions = 0;     
int selectedAnswer = 0;   

// Global variable to store current question id and broadcast timestamp
String currentQuestionId = "";
unsigned long long currentQuestionTimestamp = 0;

bool joinedSession = false;

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

void displaySessionId() {
  // Display the session id on line 2
  clearLine(2);
  String s = "Session: " + currentSessionId;
  M5.Lcd.setCursor(0, 2 * 12);
  M5.Lcd.print(s);
}

// Returns the current synchronized time in milliseconds (server time equivalent)
unsigned long long getSynchronizedTime() {
  return millis() + timeOffset;
}

void callback(char* topic, byte* payload, unsigned int length) {
  char message[256];  
  length = min(length, (unsigned int)255);
  memcpy(message, payload, length);
  message[length] = '\0';

  Serial.print("Received on topic ");
  Serial.print(topic);
  Serial.print(": ");
  Serial.println(message);

   // Handle time synchronization message
  if (strcmp(topic, time_sync_topic) == 0) {
    StaticJsonDocument<200> timeDoc;
    DeserializationError err = deserializeJson(timeDoc, message);
    if (!err) {
      unsigned long long serverTime = timeDoc["serverTime"].as<unsigned long long>();
      // Compute offset so that: serverTime = millis() + timeOffset
      timeOffset = serverTime - millis();
    } else {
      Serial.print("Time sync error: ");
      Serial.println(err.f_str());
    }
    return;
  }

  if (strcmp(topic, quiz_session_start_topic) == 0) {
    // Assume the payload contains the session id (or name)
    currentSessionId = String(message);
    Serial.print("Session started: ");
    Serial.println(currentSessionId);
    // Display the session id on the screen
    displaySessionId();
    // Also, join the session if not already joined.
    if (!joinedSession) {
      String joinPayload = String("{\"sessionName\":\"") + message + "\"}";
      Serial.print("Publishing join payload: ");
      Serial.println(joinPayload);
      if (client.publish(quiz_join_topic, joinPayload.c_str())) {
        Serial.println("Joined session successfully");
        joinedSession = true;
      } else {
        Serial.println("Failed to send join message");
      }
    }
    // Clear any "Answer sent" message since a new session started.
    clearLine(7);
    return;
  }

  if (strcmp(topic, quiz_question_topic) == 0) {
    // New question broadcast: clear the "Answer sent" message.
    clearLine(7);
    // Update last broadcast time.
    lastBroadcastTime = millis();
    
    StaticJsonDocument<4096> doc;
    DeserializationError error = deserializeJson(doc, message);
    if (error) {
      Serial.print("deserializeJson() failed: ");
      Serial.println(error.f_str());
      return;
    }
    currentQuestionId = doc["id"].as<String>();
    uint64_t ts = doc["timestamp"].as<uint64_t>();
    currentQuestionTimestamp = ts;
    Serial.print("Received question ID: ");
    Serial.println(currentQuestionId);
    Serial.print("Received question timestamp: ");
    Serial.println(currentQuestionTimestamp);
    
    totalOptions = 0;
    for (JsonObject option : doc["options"].as<JsonArray>()) {
      if (totalOptions < 4) {  
        optionIds[totalOptions] = option["id"].as<String>();
        optionTexts[totalOptions] = option["text"].as<String>();
        totalOptions++;
      }
    }
    
    selectedAnswer = 0;
    logMessage(optionTexts[selectedAnswer].c_str(), 6);
    questionActive = true;
    return;
  }

   // Handle question closed
  if (strcmp(topic, quiz_question_closed_topic) == 0) {
    Serial.println("Question Closed: " + currentQuestionId);
    
    // Mark question as inactive
    questionActive = false;
    
    // Clear the screen and display "Question Ended"
    clearLine(6);
    logMessage("Question Ended", 6);
    
    return;
  }

  if (strstr(topic, "/score") != NULL && strstr(topic, mqtt_client_id.c_str()) != NULL) {
    int newScore = 0;
    if (sscanf(message, "{\"id\":\"%*[^\"]\",\"score\":%d}", &newScore) == 1) {
      char buf[32];
      snprintf(buf, sizeof(buf), "Score: %d", newScore);
      logMessage(buf, 4);
    }
    return;
  }

  if (strcmp(topic, mqtt_client_count_topic) == 0) {
    int count = atoi(message);
    char buf[32];
    snprintf(buf, sizeof(buf), "Clients: %d", count);
    logMessage(buf, 5);
    M5.Lcd.fillRect(120, 0, 15, 15, BLUE);
    delay(100);
    M5.Lcd.fillRect(120, 0, 15, 15, GREEN);
    return;
  }
}

void setup_wifi() {
  M5.Lcd.fillRect(120, 0, 15, 15, BLACK);
  WiFi.begin(ssid, password);
  
  int dots = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    clearLine(0);
    M5.Lcd.print("WiFi");
    for (int i = 0; i < dots; i++) {
      M5.Lcd.print(".");
    }
    dots = (dots + 1) % 4;
  }
  
  clearLine(0);
  logMessage("WiFi OK!", 0);
  logMessage(WiFi.localIP().toString().c_str(), 1);
  M5.Lcd.fillRect(120, 0, 15, 15, GREEN);
}

void reconnect() {
  while (!client.connected()) {
    logMessage("MQTT connecting...", 2);
    if (client.connect(mqtt_client_id.c_str())) {
      logMessage("MQTT OK!", 2);
      client.subscribe(mqtt_client_count_topic, 1);
      String scoreTopic = String("quiz/player/") + mqtt_client_id + "/score";
      client.subscribe(scoreTopic.c_str(), 1);
      client.subscribe(quiz_session_start_topic, 1);
      client.subscribe(quiz_question_topic, 1);
      client.subscribe(time_sync_topic, 1);
      client.subscribe(quiz_question_closed_topic, 1);
    } else {
      char buf[32];
      snprintf(buf, sizeof(buf), "MQTT:%d", client.state());
      logMessage(buf, 2);
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  M5.begin();
  M5.Lcd.setRotation(3);
  M5.Lcd.fillScreen(BLACK);
  M5.Lcd.setTextSize(1);
  
  randomSeed(analogRead(0));
  
  char idBuf[32];
  snprintf(idBuf, sizeof(idBuf), "ID: %s", mqtt_client_id.c_str());
  logMessage(idBuf, 3);
  logMessage("Clients: 0", 5);
  
  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setBufferSize(2048);
  client.setKeepAlive(60);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
  M5.update();

  // Clear "Answer sent" if no new question broadcast received in 20 seconds.
  if (millis() - lastBroadcastTime > 20000) {
    clearLine(7);
  }

  if (M5.BtnA.wasPressed() && questionActive && totalOptions > 0) {
    selectedAnswer = (selectedAnswer + 1) % totalOptions;
    logMessage(optionTexts[selectedAnswer].c_str(), 6);
    Serial.print("Selected option index: ");
    Serial.println(selectedAnswer);
    Serial.print("Option UUID: ");
    Serial.println(optionIds[selectedAnswer]);
    delay(200);
  }

  if (M5.BtnB.wasPressed() && questionActive) {
    if (totalOptions > 0) {
      char payload[256];
      snprintf(payload, sizeof(payload),
               "{\"questionId\":\"%s\",\"optionId\":\"%s\",\"timestamp\":%llu}",
               currentQuestionId.c_str(), optionIds[selectedAnswer].c_str(), getSynchronizedTime());
      Serial.print("Sending payload: ");
      Serial.println(payload);
      if (client.publish(quiz_response_topic, payload)) {
        logMessage("Answer sent", 7);
        M5.Lcd.fillRect(120, 0, 15, 15, GREEN);
      } else {
        logMessage("Pub failed", 7);
        M5.Lcd.fillRect(120, 0, 15, 15, RED);
      }
    }
    delay(200);
  }
}
