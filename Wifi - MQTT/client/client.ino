#include <M5StickCPlus.h>
#include <WiFiClientSecure.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <Preferences.h>
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
const char* quiz_reset_topic = "quiz/reset-quiz"; 

// Add these with your other global variables
 Preferences preferences;
 String deviceMac = "";
 String devicePassword = "";

String mqtt_client_id = "";

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
bool selectedOptions[4] = {false, false, false, false}; 
bool isMultiSelect = false; 
unsigned long long currentQuestionTimestamp = 0;
int cursorPosition = 0; 
const int maxOptionsPerPage = 7; 

int currentScore = 0;

// WiFiClient espClient;
WiFiClientSecure espClient;
PubSubClient client(espClient);

void clearLine(int line) {
  int yPos = line * 12;
  M5.Lcd.fillRect(0, yPos, 135, 12, BLACK);
  M5.Lcd.setCursor(0, yPos);
}

void displayQuizPage() {
  
    M5.Lcd.fillScreen(BLACK);
    
    // Display session ID at top
    M5.Lcd.setCursor(0, 0);
    M5.Lcd.print("Session: " + currentSessionId);
    int optionsHeaderY = 12;
    M5.Lcd.setCursor(0, optionsHeaderY);
    M5.Lcd.print("Options:");
    
    // Calculate which options to display based on cursor position
    int displayableItems = maxOptionsPerPage;
    int totalItems = totalOptions + 1; // Add 1 for Submit option
    int startOption = (cursorPosition / displayableItems) * displayableItems;
    int endOption = min(startOption + displayableItems, totalItems);
    
    // Display options with cursor and selection status
    // Start options below the header
    const int optionsStartY = optionsHeaderY + 12;
    
    for (int i = startOption; i < endOption; i++) {
        M5.Lcd.setCursor(0, optionsStartY + (i - startOption) * 12);
        
        // Display cursor for current selection
        if (i == cursorPosition) {
            M5.Lcd.print("> ");
        } else {
            M5.Lcd.print("  ");
        }
        
        // Check if this is the submit option
        if (i == totalOptions) {
            M5.Lcd.print("SUBMIT");
        } else {
            // Display checkbox status
            if (isMultiSelect) {
                M5.Lcd.print(selectedOptions[i] ? "[X] " : "[ ] ");
            } else {
                M5.Lcd.print((selectedAnswer == i) ? "[X] " : "[ ] ");
            }
            
            // Display option text (truncate if too long)
            String displayText = optionTexts[i];
            if (displayText.length() > 15) { // Adjust based on screen width
                displayText = displayText.substring(0, 12) + "...";
            }
            M5.Lcd.print(displayText);
        }
    }
    
    // Show page indicator if there are multiple pages
    if (totalItems > maxOptionsPerPage) {
        int currentPageNum = cursorPosition / maxOptionsPerPage + 1;
        int totalPages = (totalItems + maxOptionsPerPage - 1) / maxOptionsPerPage;
        M5.Lcd.setCursor(0, M5.Lcd.height() - 12);
        M5.Lcd.printf("Page %d/%d", currentPageNum, totalPages);
    }
}

void logMessage(const char* msg, int line) {
  clearLine(line);
  M5.Lcd.setCursor(0, line * 12);
  M5.Lcd.print(msg);
}
// Add functions to send answers
void sendSingleSelectAnswer() {
  char payload[256];
  snprintf(payload, sizeof(payload),
           "{\"questionId\":\"%s\",\"optionId\":\"%s\",\"timestamp\":%llu}",
           currentQuestionId.c_str(), optionIds[selectedAnswer].c_str(), getSynchronizedTime());
  Serial.print("Sending payload: ");
  Serial.println(payload);
  int xPos = M5.Lcd.width() - 15;
  if (client.publish(quiz_response_topic, payload)) {
    logMessage("Answer Submitted", 7);
    M5.Lcd.fillRect(xPos, 0, 15, 15, GREEN);
  } else {
    logMessage("Pub failed", 7);
    M5.Lcd.fillRect(xPos, 0, 15, 15, RED);
  }
}

void sendMultiSelectAnswers() {
  // Count selected options
  int selectedCount = 0;
  for (int i = 0; i < totalOptions; i++) {
    if (selectedOptions[i]) {
      selectedCount++;
    }
  }
  
  // Only send if at least one option is selected
  if (selectedCount == 0) {
    logMessage("Select at least 1", 7);
    return;
  }
  
  // Create JSON array of selected option IDs
  StaticJsonDocument<512> doc;
  doc["questionId"] = currentQuestionId;
  doc["timestamp"] = getSynchronizedTime();
  
  JsonArray optionIdsArray = doc.createNestedArray("optionIds");
  for (int i = 0; i < totalOptions; i++) {
    if (selectedOptions[i]) {
      optionIdsArray.add(optionIds[i]);
    }
  }
  
  char payload[512];
  serializeJson(doc, payload, sizeof(payload));
  
  Serial.print("Sending multi-select payload: ");
  Serial.println(payload);
  int xPos = M5.Lcd.width() - 15;
  if (client.publish(quiz_response_topic, payload)) {
    logMessage("Answers Submitted", 7);
    M5.Lcd.fillRect(xPos, 0, 15, 15, GREEN);
  } else {
    logMessage("Pub failed", 7);
    M5.Lcd.fillRect(xPos, 0, 15, 15, RED);
  }
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

void displayCurrentOption() {
  clearLine(6);
  String displayText;
  
  if (isMultiSelect) {
    displayText = selectedOptions[selectedAnswer] ? "[X] " : "[ ] ";
    displayText += optionTexts[selectedAnswer];
  } else {
    displayText = optionTexts[selectedAnswer];
  }
  
  logMessage(displayText.c_str(), 6);
}

void callback(char* topic, byte* payload, unsigned int length) {
  char message[1024];  
  length = min(length, (unsigned int)1023);
  memcpy(message, payload, length);
  message[length] = '\0';

  if (strcmp(topic, time_sync_topic) == 1) {
    Serial.print("Received on topic ");
    Serial.print(topic);
    Serial.print(": ");
    Serial.println(message);
  }

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
    currentSessionId = "";
    expectedTapSequence = "";
    joinSequenceInput = "";
    M5.Lcd.fillScreen(BLACK);
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

    // Log the type field
    String questionType = doc["type"].as<String>();
    Serial.print("Received question type: ");
    Serial.println(questionType);

    // Set the isMultiSelect flag
    isMultiSelect = (questionType == "multi_select");
    Serial.print("isMultiSelect: ");
    Serial.println(isMultiSelect);

    // isMultiSelect = doc["type"].as<String>() == "multi_select";

    Serial.print("Received question ID: ");
    Serial.println(currentQuestionId);
    Serial.print("Received question timestamp: ");
    Serial.println(currentQuestionTimestamp);

    for (int i = 0; i < 4; i++) {
      selectedOptions[i] = false;
    }

    
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

    cursorPosition = 0;
    displayQuizPage();
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
      currentScore = newScore;
    }
    return;
  }

  // Handle client count updates
  if (strcmp(topic, mqtt_client_count_topic) == 0) {
    int count = atoi(message);
    char buf[32];
    snprintf(buf, sizeof(buf), "Clients: %d", count);
    logMessage(buf, 9);
    return;
  }

  // Handle end-of-quiz message
  if (strcmp(topic, "quiz/end") == 0) {
    Serial.println("Quiz Ended");
    // Reset quiz-related state variables
    joinedSession = false;
    questionActive = false;
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
    clearLine(7);
    M5.Lcd.setCursor(0, 12); 
    M5.Lcd.print("Quiz Ended");
    char buf[32];
    snprintf(buf, sizeof(buf), "Final Score: %d", currentScore);
    clearLine(8);
    M5.Lcd.setCursor(0, 8 * 12);
    M5.Lcd.print(buf);
    return;
  }

  // Listen for the "reset-quiz" topic.
  if (strcmp(topic, "quiz/reset-quiz") == 0) {
    Serial.println("Reset-quiz message received.");
    StaticJsonDocument<200> resetDoc;
    DeserializationError err = deserializeJson(resetDoc, message);
    if (err) {
      Serial.print("Reset payload parse error: ");
      Serial.println(err.f_str());
      return;
    }
    // Get the sessionId from the payload.
    String sessionIdFromReset = resetDoc["sessionId"].as<String>();
    Serial.print("Reset session ID: ");
    Serial.println(sessionIdFromReset);
    joinedSession = true;
    String joinPayload = String("{\"sessionId\":\"") + sessionIdFromReset + "\",\"auth\":\"" + expectedTapSequence + "\"}";
    Serial.print("Auto-join payload: ");
    Serial.println(joinPayload);
    if (client.publish(quiz_join_topic, joinPayload.c_str())) {
      Serial.println("Auto-join request sent successfully.");
      joinedSession = true;
      logMessage("Auto-Joined", 5);
    } else {
      Serial.println("Auto-join request failed.");
      logMessage("Auto-join failed", 5);
    }
    logMessage("Rejoined Session", 5);
    return;
  }
}

void setup_wifi() {
  M5.Lcd.fillRect(120, 0, 15, 15, BLACK);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int dots = 0;
  int xPos = M5.Lcd.width() - 15;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    clearLine(0);
    M5.Lcd.print("WiFi");
    for (int i = 0; i < dots; i++) {
      M5.Lcd.print(".");
    }
    dots = (dots + 1) % 4;
    M5.Lcd.fillRect(xPos, 0, 15, 15, RED);
  }
  clearLine(0);
  logMessage("WiFi OK!", 0);
  logMessage(WiFi.localIP().toString().c_str(), 1);
  M5.Lcd.fillRect(xPos, 0, 15, 15, GREEN);
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
  int xPos = M5.Lcd.width() - 15;
  while (!client.connected()) {
    logMessage("MQTT connecting...", 2);
    Serial.println("Attempting MQTT connection with credentials:");
    M5.Lcd.fillRect(xPos, 0, 15, 15, RED);
    Serial.print("Client ID: ");
    Serial.println(mqtt_client_id);
    Serial.print("Username (MAC): ");
    Serial.println(deviceMac);
    Serial.print("Password length: ");
    Serial.println(devicePassword.length());
    if (client.connect(mqtt_client_id.c_str(), deviceMac.c_str(), devicePassword.c_str()) ) {
      logMessage("MQTT OK!", 2);
      M5.Lcd.fillRect(xPos, 0, 15, 15, GREEN);
      client.subscribe(mqtt_client_count_topic, 1);
      String scoreTopic = String("quiz/player/") + mqtt_client_id + "/score";
      client.subscribe(scoreTopic.c_str(), 1);
      client.subscribe(quiz_session_start_topic, 1);
      client.subscribe(quiz_question_topic, 1);
      client.subscribe(time_sync_topic, 1);
      client.subscribe(quiz_question_closed_topic, 1);
      client.subscribe(quiz_auth_topic, 1);
      client.subscribe(quiz_end_topic, 1);
      client.subscribe(quiz_reset_topic, 1);
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

  preferences.begin("mqtt-creds", true); // Read-only mode
  deviceMac = preferences.getString("macAddress", "");
  devicePassword = preferences.getString("password", "");
  
  // Check if credentials are available
  if (deviceMac == "" || devicePassword == "") {
    M5.Lcd.setCursor(0, 0);
    M5.Lcd.println("No credentials found!");
    M5.Lcd.setCursor(0, 12);
    M5.Lcd.println("Run registration first");
    Serial.println("ERROR: No credentials found. Please run the registration sketch first.");
    while(1) { delay(1000); } // Halt execution
  }
  
  // Generate a client ID based on the MAC address instead of random
  mqtt_client_id = "M5Stick-" + deviceMac.substring(deviceMac.length() - 6);

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
  int xPos = M5.Lcd.width() - 15;

  // Main page logic (existing code for joining session)
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
          M5.Lcd.fillRect(xPos, 0, 15, 15, GREEN);
        } else {
          Serial.println("Failed to send join message");
        }
      } else {
        Serial.println("Incorrect tap sequence. Resetting input.");
        joinSequenceInput = "";
        clearLine(4);
        M5.Lcd.setCursor(0, 4 * 12);
        M5.Lcd.print("YourSeq: ");
        M5.Lcd.fillRect(xPos, 0, 15, 15, RED);
      }
    }
  }
  else {
    // If joined and a question is active, allow answer selection.
    if (questionActive && totalOptions > 0) {
      if (M5.BtnA.wasPressed()) {
        // Move cursor down, wrap around if needed
        cursorPosition = (cursorPosition + 1) % (totalOptions + 1); // +1 for Submit option
        displayQuizPage();
        delay(200);
      }
      
      if (M5.BtnB.wasPressed()) {
        // Check if Submit option is selected
        if (cursorPosition == totalOptions) {
          // Submit answers
          if (isMultiSelect) {
            sendMultiSelectAnswers();
          } else {
            // For single select, check if an option is selected
            bool hasSelection = false;
            for (int i = 0; i < totalOptions; i++) {
              if (selectedAnswer == i) {
                hasSelection = true;
                break;
              }
            }
            
            if (hasSelection) {
              sendSingleSelectAnswer();
            } else {
              // Display a message if no option is selected
              M5.Lcd.setCursor(0, M5.Lcd.height() - 36);
              M5.Lcd.print("Select an option first!");
              delay(1000);
              displayQuizPage(); // Redraw the page
            }
          }
        } else {
          // Toggle selection for current option
          if (isMultiSelect) {
            selectedOptions[cursorPosition] = !selectedOptions[cursorPosition];
          } else {
            // For single select, just update the selection
            selectedAnswer = cursorPosition;
          }
          displayQuizPage();
        }
        delay(200);
      }
    }
  }
}