#include <M5StickCPlus.h>
#include <WiFiClientSecure.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include "config.h"


const char* mqtt_client_count_topic = "system/client_count";

// MQTT topics
const char* quiz_response_topic = "quiz/response";
const char* quiz_join_topic = "quiz/session/join";
const char* quiz_question_topic = "quiz/question";
const char* quiz_question_closed_topic = "quiz/question/closed";
const char* quiz_session_start_topic = "quiz/session/start";
const char* time_sync_topic = "system/time/sync";
const char* quiz_auth_topic = "quiz/auth";  
const char* quiz_end_topic = "quiz/end"; 

// Generate a random client ID
String getRandomClientId() {
  String id = "m5stick_";
  for (int i = 0; i < 4; i++) {
    id += String(random(0xF), HEX);
  }
  return id;
}
String mqtt_client_id = getRandomClientId();

// Global variables
String currentSessionId = "";
String expectedTapSequence = "";  // Expected tap sequence from teacher.
String joinSequenceInput = "";    // The sequence the student has tapped.
unsigned long lastBroadcastTime = 0;
unsigned long long timeOffset = 0;
bool questionActive = false;      // Indicates if a question is open.
bool joinedSession = false;       // Indicates if this device has joined.

// For questions/answers
String optionIds[4];
String optionTexts[4];
int totalOptions = 0;
int selectedAnswer = 0;
String currentQuestionId = "";
unsigned long long currentQuestionTimestamp = 0;

// WiFiClient espClient;
WiFiClientSecure espClient;
PubSubClient client(espClient);

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

void displaySessionInfo() {
  clearLine(2);
  String s = "Session: " + currentSessionId;
  M5.Lcd.setCursor(0, 2 * 12);
  M5.Lcd.print(s);
  // Also display expected tap sequence on line 3
  // clearLine(3);
  // String t = "TapSeq: " + expectedTapSequence;
  // M5.Lcd.setCursor(0, 3 * 12);
  // M5.Lcd.print(t);
  // And display entered sequence on line 4
  clearLine(4);
  String j = "YourSeq: " + joinSequenceInput;
  M5.Lcd.setCursor(0, 4 * 12);
  M5.Lcd.print(j);
}

// Synchronize system time using NTP
void syncTime() {
  Serial.print("Synchronizing time via NTP");
  // Set timezone offset (in seconds) and DST offset (in seconds) as needed.
  // Here we use UTC (offset 0) for simplicity.
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  // Wait until time is set. (time(nullptr) returns a Unix timestamp.)
  while (time(nullptr) < 1000000000) {  // roughly until the year 2001
    Serial.print(".");
    delay(500);
  }
  Serial.println(" Time synchronized!");
}

// Returns the synchronized time (server time equivalent)
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

  // Time sync
  if (strcmp(topic, time_sync_topic) == 0) {
    StaticJsonDocument<200> timeDoc;
    DeserializationError err = deserializeJson(timeDoc, message);
    if (!err) {
      unsigned long long serverTime = timeDoc["serverTime"].as<unsigned long long>();
      timeOffset = serverTime - millis();
    } else {
      Serial.print("Time sync error: ");
      Serial.println(err.f_str());
    }
    return;
  }

  // Handle auth broadcast
  if (strcmp(topic, quiz_auth_topic) == 0) {
    StaticJsonDocument<200> authDoc;
    DeserializationError err = deserializeJson(authDoc, message);
    if (err) {
      Serial.print("Auth parse error: ");
      Serial.println(err.f_str());
      return;
    }
    // Expect payload: {"sessionId": "...", "sessionName": "...", "tapSequence": "..."}
    String sessionIdFromAuth = authDoc["sessionId"].as<String>();
    String tapSeq = authDoc["tapSequence"].as<String>();
    expectedTapSequence = tapSeq;
    currentSessionId = sessionIdFromAuth;
    Serial.print("Received auth sequence: ");
    Serial.println(expectedTapSequence);
    Serial.print("Received session ID: ");
    Serial.println(currentSessionId);
    displaySessionInfo();
    return;
  }

  // Handle session start (contains session name and expected tap sequence)
  if (strcmp(topic, quiz_session_start_topic) == 0) {
    // Parse JSON payload; expect {"sessionName": "Quiz123", "tapSequence": "ABBA"}
    StaticJsonDocument<200> sessionDoc;
    DeserializationError err = deserializeJson(sessionDoc, message);
    if (err) {
      Serial.print("Session start parse error: ");
      Serial.println(err.f_str());
      return;
    }
    currentSessionId = sessionDoc["sessionName"].as<String>();
    expectedTapSequence = sessionDoc["tapSequence"].as<String>();
    Serial.print("tap Sequence: ");
    Serial.println(expectedTapSequence);
    Serial.print("Session started: ");
    Serial.println(currentSessionId);
    displaySessionInfo();
    clearLine(7);
    return;
  }

  // Handle question broadcast
  if (strcmp(topic, quiz_question_topic) == 0) {
    clearLine(7);
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
    questionActive = false;
    clearLine(6);
    logMessage("Question Ended", 6);
    return;
  }

  // Handle score updates
  if (strstr(topic, "/score") != NULL && strstr(topic, mqtt_client_id.c_str()) != NULL) {
    int newScore = 0;
    if (sscanf(message, "{\"id\":\"%*[^\"]\",\"score\":%d}", &newScore) == 1) {
      char buf[32];
      snprintf(buf, sizeof(buf), "Score: %d", newScore);
      logMessage(buf, 8); // Display score on line 8
    }
    return;
  }

  // Handle client count updates
  if (strcmp(topic, mqtt_client_count_topic) == 0) {
    int count = atoi(message);
    char buf[32];
    snprintf(buf, sizeof(buf), "Clients: %d", count);
    logMessage(buf, 9);
    M5.Lcd.fillRect(120, 0, 15, 15, BLUE);
    delay(100);
    M5.Lcd.fillRect(120, 0, 15, 15, GREEN);
    return;
  }

  // Handle end-of-quiz message
  if (strcmp(topic, "quiz/end") == 0) {
    Serial.println("Quiz Ended");
    // Reset quiz-related state variables
    joinedSession = false;
    questionActive = false;
    currentSessionId = "";
    expectedTapSequence = "";
    joinSequenceInput = "";
    totalOptions = 0;
    selectedAnswer = 0;
    currentQuestionId = "";
    currentQuestionTimestamp = 0;
    // Clear relevant display areas and show a default message
    clearLine(2);
    clearLine(3);
    clearLine(4);
    clearLine(5);
    clearLine(6);
    return;
  }
}

void setup_wifi() {
  M5.Lcd.fillRect(120, 0, 15, 15, BLACK);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
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

void printCurrentTime() {
  time_t now = time(nullptr);  // get current time as Unix timestamp
  struct tm *timeinfo = localtime(&now);
  char buffer[30];
  strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", timeinfo);
  Serial.print("Current Time: ");
  Serial.println(buffer);
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
      client.subscribe(quiz_auth_topic, 1);
      client.subscribe(quiz_end_topic, 1);
    } else {
      char buf[32];
      Serial.println(client.state());
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
  loadConfig();
  randomSeed(analogRead(0));

  char idBuf[32];
  snprintf(idBuf, sizeof(idBuf), "ID: %s", mqtt_client_id.c_str());
  logMessage(idBuf, 3);
  logMessage("Clients: 0", 9);
  setup_wifi();

   // Synchronize time with an NTP server
  syncTime();
  printCurrentTime();
  
  espClient.setCACert(CA_CERT);
  client.setServer(MQTT_SERVER, MQTT_PORT);
  client.setCallback(callback);
  client.setBufferSize(4096);
  client.setKeepAlive(120);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
  M5.update();

  // Clear "Answer sent" message if no new question broadcast after 20 seconds.
  if (millis() - lastBroadcastTime > 20000) {
    clearLine(7);
  }

  // If not yet joined, allow the student to input tap sequence using buttons.
  if (!joinedSession) {
    // Use BtnA for "A", BtnB for "B".
    if (M5.BtnA.wasPressed()) {
      joinSequenceInput += "A";
      Serial.print("Tap input: ");
      Serial.println(joinSequenceInput);
      clearLine(4);
      M5.Lcd.setCursor(0, 4 * 12);
      M5.Lcd.print("YourSeq: " + joinSequenceInput);
      delay(200);
    }
    if (M5.BtnB.wasPressed()) {
      joinSequenceInput += "B";
      Serial.print("Tap input: ");
      Serial.println(joinSequenceInput);
      clearLine(4);
      M5.Lcd.setCursor(0, 4 * 12);
      M5.Lcd.print("YourSeq: " + joinSequenceInput);
      delay(200);
    }
    // If input length equals expected tap sequence length, check if it matches.
    if (expectedTapSequence.length() > 0 &&
        joinSequenceInput.length() >= expectedTapSequence.length()) {
        Serial.print("Tap input: ");
        Serial.println(expectedTapSequence);  
      if (joinSequenceInput == expectedTapSequence) {
        // Publish join payload.
        String joinPayload = String("{\"sessionId\":\"") + currentSessionId + "\",\"auth\":\"" + joinSequenceInput + "\"}";
        Serial.print("Publishing join payload: ");
        Serial.println(joinPayload);
        if (client.publish(quiz_join_topic, joinPayload.c_str())) {
          Serial.println("Joined session successfully");
          joinedSession = true;
          clearLine(5);
          logMessage("Joined Session", 5);
        } else {
          Serial.println("Failed to send join message");
        }
      } else {
        Serial.println("Incorrect tap sequence. Resetting input.");
        joinSequenceInput = "";
        clearLine(4);
        M5.Lcd.setCursor(0, 4 * 12);
        M5.Lcd.print("YourSeq: ");
      }
    }
  }
  else {
    // If joined and a question is active, allow answer selection.
    if (questionActive && totalOptions > 0) {
      if (M5.BtnA.wasPressed()) {
        selectedAnswer = (selectedAnswer + 1) % totalOptions;
        logMessage(optionTexts[selectedAnswer].c_str(), 6);
        Serial.print("Selected option index: ");
        Serial.println(selectedAnswer);
        Serial.print("Option UUID: ");
        Serial.println(optionIds[selectedAnswer]);
        delay(200);
      }
      if (M5.BtnB.wasPressed()) {
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
        delay(200);
      }
    }
  }
}
