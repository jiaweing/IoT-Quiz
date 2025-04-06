#include <M5StickCPlus.h>
#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include <time.h>
#include "config.h"

// Define property flags if not defined
#ifndef NIMBLE_PROPERTY_READ
  #define NIMBLE_PROPERTY_READ 0x02
#endif
#ifndef NIMBLE_PROPERTY_WRITE
  #define NIMBLE_PROPERTY_WRITE 0x08
#endif
#ifndef NIMBLE_PROPERTY_NOTIFY
  #define NIMBLE_PROPERTY_NOTIFY 0x10
#endif

// UUID definitions
#define QUIZ_SERVICE_UUID                  "12345678-1234-5678-1234-56789abcdef0"
#define AUTH_CHARACTERISTIC_UUID           "abcdef01-1234-5678-1234-56789abcdef0"
#define QUESTION_CHARACTERISTIC_UUID       "abcdef02-1234-5678-1234-56789abcdef0"
#define QUESTION_CLOSED_CHARACTERISTIC_UUID "abcdef03-1234-5678-1234-56789abcdef0"
#define RESPONSE_CHARACTERISTIC_UUID       "abcdef04-1234-5678-1234-56789abcdef0"
#define SCORE_CHARACTERISTIC_UUID          "abcdef05-1234-5678-1234-56789abcdef0"
#define DISTRIBUTION_CHARACTERISTIC_UUID    "abcdef06-1234-5678-1234-56789abcdef0"
#define SESSION_STATUS_CHARACTERISTIC_UUID "abcdef07-1234-5678-1234-56789abcdef0"
#define TIME_SYNC_CHARACTERISTIC_UUID      "abcdef08-1234-5678-1234-56789abcdef0"

// ------------------ Global Variables ------------------

// Quiz state variables
String currentSessionId = "";
String expectedTapSequence = "";
String joinSequenceInput = "";
unsigned long lastBroadcastTime = 0;
unsigned long long timeOffset = 0;
bool questionActive = false;
bool joinedSession = false;

// Option data & selection
String optionIds[4];
String optionTexts[4];
int totalOptions = 0;

// For single-select
int selectedAnswer = 0;

// For multi-select
bool isMultiSelect = false;
bool selectedOptions[4] = { false, false, false, false };
int cursorPosition = 0; // For multi-select cursor; the SUBMIT option is at index totalOptions

String currentQuestionId = "";
unsigned long long currentQuestionTimestamp = 0;
int currentScore = 0;

// BLE characteristic pointers
NimBLECharacteristic* pAuthCharacteristic;
NimBLECharacteristic* pQuestionCharacteristic;
NimBLECharacteristic* pQuestionClosedCharacteristic;
NimBLECharacteristic* pResponseCharacteristic;
NimBLECharacteristic* pSessionStatusCharacteristic;
NimBLECharacteristic* pTimeSyncCharacteristic;
NimBLECharacteristic* pScoreCharacteristic;

// ------------------ Display Helpers ------------------

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
  
  clearLine(4);
  String j = "YourSeq: " + joinSequenceInput;
  M5.Lcd.setCursor(0, 4 * 12);
  M5.Lcd.print(j);
}

// New display function with pagination that works for both single-select and multi-select.
const int maxOptionsPerPage = 7; // Maximum items per page

void displayQuizPageBLE() {
  M5.Lcd.fillScreen(BLACK);
  
  // Display session ID at top
  M5.Lcd.setCursor(0, 0);
  M5.Lcd.print("Session: " + currentSessionId);
  int optionsHeaderY = 12;
  M5.Lcd.setCursor(0, optionsHeaderY);
  M5.Lcd.print("Options:");
  
  // Calculate pagination details
  int totalItems = totalOptions + 1; // +1 for the SUBMIT row
  int startOption = (cursorPosition / maxOptionsPerPage) * maxOptionsPerPage;
  int endOption = min(startOption + maxOptionsPerPage, totalItems);
  
  // Display options with cursor and selection/checkbox
  const int optionsStartY = optionsHeaderY + 12;
  for (int i = startOption; i < endOption; i++) {
    M5.Lcd.setCursor(0, optionsStartY + (i - startOption) * 12);
    
    // Display cursor for current selection
    if (i == cursorPosition) {
      M5.Lcd.print("> ");
    } else {
      M5.Lcd.print("  ");
    }
    
    // Check if this is the SUBMIT row.
    if (i == totalOptions) {
      M5.Lcd.print("SUBMIT");
    } else {
      // For multi-select, display checkboxes; for single-select, show selection based on selectedAnswer.
      if (isMultiSelect) {
        M5.Lcd.print(selectedOptions[i] ? "[X] " : "[ ] ");
      } else {
        M5.Lcd.print((selectedAnswer == i) ? "[X] " : "[ ] ");
      }
      
      // Display option text; truncate if needed.
      String displayText = optionTexts[i];
      if (displayText.length() > 15) {
        displayText = displayText.substring(0, 12) + "...";
      }
      M5.Lcd.print(displayText);
    }
  }
  
  // Display page indicator if there are multiple pages.
  if (totalItems > maxOptionsPerPage) {
    int currentPageNum = cursorPosition / maxOptionsPerPage + 1;
    int totalPages = (totalItems + maxOptionsPerPage - 1) / maxOptionsPerPage;
    M5.Lcd.setCursor(0, M5.Lcd.height() - 12);
    M5.Lcd.printf("Page %d/%d", currentPageNum, totalPages);
  }
}

// ------------------ BLE Callback Classes ------------------

// Auth characteristic callback.
class AuthCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& connInfo) override {
    std::string value = pCharacteristic->getValue();
    Serial.print("Auth written: ");
    Serial.println(value.c_str());
    
    StaticJsonDocument<200> authDoc;
    DeserializationError err = deserializeJson(authDoc, value);
    if (!err) {
      String sessionIdFromAuth = authDoc["sessionId"].as<String>();
      String tapSeq = authDoc["tapSequence"].as<String>();
      expectedTapSequence = tapSeq;
      currentSessionId = sessionIdFromAuth;
      Serial.print("Received tap sequence: ");
      Serial.println(expectedTapSequence);
      Serial.print("Session ID: ");
      Serial.println(currentSessionId);
      clearLine(8);
      displaySessionInfo();
    } else {
      Serial.print("Auth parse error: ");
      Serial.println(err.f_str());
    }
  }
};

// Question characteristic callback.
class QuestionCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& connInfo) override {
    std::string value = pCharacteristic->getValue();
    Serial.print("Question written: ");
    Serial.println(value.c_str());
    
    lastBroadcastTime = millis();
    StaticJsonDocument<4096> doc;
    DeserializationError error = deserializeJson(doc, value);
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
    Serial.print("Timestamp: ");
    Serial.println(currentQuestionTimestamp);
    
    // Read question type to determine if multi-select.
    String questionType = doc["type"].as<String>();
    isMultiSelect = (questionType == "multi_select");
    Serial.print("Received question type: ");
    Serial.println(questionType);
    Serial.print("isMultiSelect: ");
    Serial.println(isMultiSelect);
    
    // Reset option arrays and selection state.
    totalOptions = 0;
    for (JsonObject option : doc["options"].as<JsonArray>()) {
      if (totalOptions < 4) {
        optionIds[totalOptions] = option["id"].as<String>();
        optionTexts[totalOptions] = option["text"].as<String>();
        totalOptions++;
      }
    }

    for (int i = 0; i < totalOptions; i++) {
      selectedOptions[i] = false;
    }

    selectedAnswer = 0;
    logMessage(optionTexts[selectedAnswer].c_str(), 6);
    questionActive = true;
    cursorPosition = 0;
    displayQuizPageBLE();
  }
};

// Question Closed characteristic callback.
class QuestionClosedCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& connInfo) override {
    std::string value = pCharacteristic->getValue();
    Serial.print("Question closed written: ");
    Serial.println(value.c_str());
    questionActive = false;
    clearLine(6);
    clearLine(7);
    logMessage("Question Ended", 6);
  }
};

// Session Status characteristic callback.
class SessionStatusCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& connInfo) override {
    std::string value = pCharacteristic->getValue();
    Serial.print("Session status written: ");
    Serial.println(value.c_str());
    StaticJsonDocument<200> statusDoc;
    DeserializationError err = deserializeJson(statusDoc, value);
    if (!err) {
      String newStatus = statusDoc["status"].as<String>();
      String msg = "Quiz " + newStatus;
      logMessage(msg.c_str(), 8);
      if(newStatus == "Completed") {
        // Reset quiz state
        joinedSession = false;
        questionActive = false;
        currentSessionId = "";
        expectedTapSequence = "";
        joinSequenceInput = "";
        totalOptions = 0;
        selectedAnswer = 0;
        currentQuestionId = "";
        currentQuestionTimestamp = 0;
        M5.Lcd.fillScreen(BLACK);
        M5.Lcd.setCursor(0, 12);
        M5.Lcd.print("Quiz Ended");
        char buf[32];
        snprintf(buf, sizeof(buf), "Final Score: %d", currentScore);
        M5.Lcd.setCursor(0, 8 * 12);
        M5.Lcd.print(buf);

        Serial.println("Quiz state reset due to Completed status");
      }
    } else {
      Serial.print("Session status parse error: ");
      Serial.println(err.f_str());
    }
  }
};

// Time Sync characteristic callback.
class TimeSyncCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& connInfo) override {
    std::string value = pCharacteristic->getValue();
    Serial.print("Time sync written: ");
    Serial.println(value.c_str());
    
    StaticJsonDocument<200> timeDoc;
    DeserializationError err = deserializeJson(timeDoc, value);
    if (!err) {
      unsigned long long serverTime = timeDoc["serverTime"].as<unsigned long long>();
      timeOffset = serverTime - millis();
      Serial.print("Time synchronized. Offset: ");
      Serial.println(timeOffset);
    } else {
      Serial.print("Time sync error: ");
      Serial.println(err.f_str());
    }
  }
};

class ScoreCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& connInfo) override {
    std::string value = pCharacteristic->getValue();
    Serial.print("Score update written: ");
    Serial.println(value.c_str());

    StaticJsonDocument<200> scoreDoc;
    DeserializationError err = deserializeJson(scoreDoc, value);
    if (!err) {
      int newScore = scoreDoc["score"] | 0;
      currentScore = newScore;

    } else {
      Serial.print("Score parse error: ");
      Serial.println(err.f_str());
    }
  }
};



// ------------------ BLE Setup ------------------

void setupBLE() {
  int xPos = M5.Lcd.width() - 15;

  // Clear indicator area and show "BLE" with dots
  M5.Lcd.fillRect(xPos, 0, 15, 15, BLACK);
  clearLine(0);
  M5.Lcd.setCursor(0, 0);
  M5.Lcd.print("BLE");

  // Set red indicator while initializing
  M5.Lcd.fillRect(xPos, 0, 15, 15, RED);

  NimBLEDevice::init("M5StickCPlus Quiz Client");
  NimBLEServer* pServer = NimBLEDevice::createServer();
  NimBLEService* pService = pServer->createService(QUIZ_SERVICE_UUID);
  
  // Create and set up the Auth characteristic.
  pAuthCharacteristic = pService->createCharacteristic(
    AUTH_CHARACTERISTIC_UUID,
    NIMBLE_PROPERTY_READ | NIMBLE_PROPERTY_WRITE | NIMBLE_PROPERTY_NOTIFY
  );
  pAuthCharacteristic->setCallbacks(new AuthCallbacks());
  
  // Create and set up the Question characteristic.
  pQuestionCharacteristic = pService->createCharacteristic(
    QUESTION_CHARACTERISTIC_UUID,
    NIMBLE_PROPERTY_READ | NIMBLE_PROPERTY_WRITE | NIMBLE_PROPERTY_NOTIFY
  );
  pQuestionCharacteristic->setCallbacks(new QuestionCallbacks());
  
  // Create and set up the Question Closed characteristic.
  pQuestionClosedCharacteristic = pService->createCharacteristic(
    QUESTION_CLOSED_CHARACTERISTIC_UUID,
    NIMBLE_PROPERTY_READ | NIMBLE_PROPERTY_WRITE | NIMBLE_PROPERTY_NOTIFY
  );
  pQuestionClosedCharacteristic->setCallbacks(new QuestionClosedCallbacks());
  
  // Create the Response characteristic (for join/answer responses).
  pResponseCharacteristic = pService->createCharacteristic(
    RESPONSE_CHARACTERISTIC_UUID,
    NIMBLE_PROPERTY_WRITE | NIMBLE_PROPERTY_NOTIFY
  );
  
  // Create and set up the Session Status characteristic.
  pSessionStatusCharacteristic = pService->createCharacteristic(
    SESSION_STATUS_CHARACTERISTIC_UUID,
    NIMBLE_PROPERTY_READ | NIMBLE_PROPERTY_WRITE | NIMBLE_PROPERTY_NOTIFY
  );
  pSessionStatusCharacteristic->setCallbacks(new SessionStatusCallbacks());
  
  // Create and set up the Time Sync characteristic.
  pTimeSyncCharacteristic = pService->createCharacteristic(
    TIME_SYNC_CHARACTERISTIC_UUID,
    NIMBLE_PROPERTY_READ | NIMBLE_PROPERTY_WRITE | NIMBLE_PROPERTY_NOTIFY
  );
  pTimeSyncCharacteristic->setCallbacks(new TimeSyncCallbacks());

  // Score characteristic
  pScoreCharacteristic = pService->createCharacteristic(
    SCORE_CHARACTERISTIC_UUID,
    NIMBLE_PROPERTY_READ | NIMBLE_PROPERTY_WRITE | NIMBLE_PROPERTY_NOTIFY
  );
  pScoreCharacteristic->setCallbacks(new ScoreCallbacks());

  
  pService->start();
  
  NimBLEAdvertising* pAdvertising = NimBLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(QUIZ_SERVICE_UUID);
  NimBLEAdvertisementData scanRespData;
  scanRespData.setName("QuizService");
  pAdvertising->setScanResponseData(scanRespData);
  pAdvertising->start();
  clearLine(0);
  logMessage("BLE OK!", 0);
  M5.Lcd.fillRect(xPos, 0, 15, 15, GREEN);

  Serial.println("BLE Advertising started");
}

// ------------------ Time Sync Helper ------------------

unsigned long long getSynchronizedTime() {
  return millis() + timeOffset;
}

// ------------------ Generate Random Client ID ------------------

String getRandomClientId() {
  String id = "m5stick_";
  for (int i = 0; i < 4; i++) {
    id += String(random(0xF), HEX);
  }
  return id;
}
String clientId = getRandomClientId();

// ------------------ Single-Select Answer Function ------------------
void sendSingleSelectAnswer() {
  char payload[256];
  snprintf(payload, sizeof(payload),
                   "{\"action\":\"response\",\"questionId\":\"%s\",\"optionId\":\"%s\",\"timestamp\":%llu}",
                   currentQuestionId.c_str(), optionIds[selectedAnswer].c_str(), getSynchronizedTime());
  Serial.print("Sending single-select payload: ");
  Serial.println(payload);
  int xPos = M5.Lcd.width() - 15;
  std::string joinStr(payload, strlen(payload));
  pResponseCharacteristic->setValue(joinStr);
  pResponseCharacteristic->notify();
  logMessage("Answer sent", 7);
}

// ------------------ Multi-Select Answer Function ------------------

void sendMultiSelectAnswers() {
  int selectedCount = 0;
  for (int i = 0; i < totalOptions; i++) {
    if (selectedOptions[i]) selectedCount++;
  }
  if (selectedCount == 0) {
    logMessage("Select at least 1", 7);
    return;
  }
  
  StaticJsonDocument<512> doc;
  doc["action"] = "response";
  doc["questionId"] = currentQuestionId;
  doc["timestamp"] = getSynchronizedTime();
  
  JsonArray arr = doc.createNestedArray("optionIds");
  for (int i = 0; i < totalOptions; i++) {
    if (selectedOptions[i]) {
      arr.add(optionIds[i]);
    }
  }
  
  String payload;
  serializeJson(doc, payload);
  Serial.print("Sending multi-select payload: ");
  Serial.println(payload);
  pResponseCharacteristic->setValue(payload.c_str());
  pResponseCharacteristic->notify();
  logMessage("Answers sent", 7);
}

// ------------------ Setup ------------------

void setup() {
  Serial.begin(115200);
  M5.begin();
  M5.Lcd.setRotation(3);
  M5.Lcd.fillScreen(BLACK);
  M5.Lcd.setTextSize(1);
  
  setupBLE();
  Serial.println("BLE setup complete");
  
  char idBuf[32];
  snprintf(idBuf, sizeof(idBuf), "ID: %s", clientId.c_str());
  logMessage(idBuf, 3);
}

// ------------------ Main Loop ------------------

void loop() {
  M5.update();
  
  // Before joining, handle tap sequence input.
  if (!joinedSession) {
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
    if (expectedTapSequence.length() > 0 &&
        joinSequenceInput.length() >= expectedTapSequence.length()) {
      Serial.print("Expected tap sequence: ");
      Serial.println(expectedTapSequence);
      if (joinSequenceInput == expectedTapSequence) {
        // Build join payload with action "join"
        StaticJsonDocument<200> joinDoc;
        joinDoc["action"] = "join";
        joinDoc["sessionId"] = currentSessionId;
        joinDoc["auth"] = joinSequenceInput;
        String joinPayload;
        serializeJson(joinDoc, joinPayload);
        pResponseCharacteristic->setValue(joinPayload.c_str());
        pResponseCharacteristic->notify();
        Serial.print("Sent join payload: ");
        Serial.println(joinPayload);
        joinedSession = true;
        clearLine(5);
        logMessage("Joined Session", 5);
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
    // If joined and a question is active, process answer selection.
    if (questionActive && totalOptions > 0) {
      if (M5.BtnA.wasPressed()) {
        cursorPosition = (cursorPosition + 1) % (totalOptions + 1);
        displayQuizPageBLE();
        delay(200);
      }

      if (M5.BtnB.wasPressed()) {
        if (cursorPosition == totalOptions) {
          if (isMultiSelect) {
            sendMultiSelectAnswers();
          } else {
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
              displayQuizPageBLE(); // Redraw the page
            }
          }
        } else {

          if (isMultiSelect) {
              selectedOptions[cursorPosition] = !selectedOptions[cursorPosition];
            } else {
              // For single select, just update the selection
              selectedAnswer = cursorPosition;
            }
            displayQuizPageBLE();
          }
          
          delay(200);
      }
    }
  }
}
