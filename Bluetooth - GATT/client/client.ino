#include <M5StickCPlus.h>
#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include <time.h>
#include "config.h"

// Define property flags if not defined (used for setting characteristic properties)
#ifndef NIMBLE_PROPERTY_READ
  #define NIMBLE_PROPERTY_READ 0x02
#endif
#ifndef NIMBLE_PROPERTY_WRITE
  #define NIMBLE_PROPERTY_WRITE 0x08
#endif
#ifndef NIMBLE_PROPERTY_NOTIFY
  #define NIMBLE_PROPERTY_NOTIFY 0x10
#endif

// UUID definitions (all in hyphenated format)
#define QUIZ_SERVICE_UUID                  "12345678-1234-5678-1234-56789abcdef0"
#define AUTH_CHARACTERISTIC_UUID           "abcdef01-1234-5678-1234-56789abcdef0"
#define QUESTION_CHARACTERISTIC_UUID       "abcdef02-1234-5678-1234-56789abcdef0"
#define QUESTION_CLOSED_CHARACTERISTIC_UUID "abcdef03-1234-5678-1234-56789abcdef0"
#define RESPONSE_CHARACTERISTIC_UUID       "abcdef04-1234-5678-1234-56789abcdef0"
#define SCORE_CHARACTERISTIC_UUID          "abcdef05-1234-5678-1234-56789abcdef0"
#define DISTRIBUTION_CHARACTERISTIC_UUID     "abcdef06-1234-5678-1234-56789abcdef0"
#define SESSION_STATUS_CHARACTERISTIC_UUID "abcdef07-1234-5678-1234-56789abcdef0"
#define TIME_SYNC_CHARACTERISTIC_UUID      "abcdef08-1234-5678-1234-56789abcdef0"

// Global variables for quiz state tracking
String currentSessionId = "";         // Active session ID
String expectedTapSequence = "";        // Expected tap sequence for joining
String joinSequenceInput = "";          // Sequence entered by user via buttons
unsigned long lastBroadcastTime = 0;    // Timestamp for last question broadcast
unsigned long long timeOffset = 0;      // Offset for time synchronization
bool questionActive = false;            // True if a question is active
bool joinedSession = false;             // True if device has joined the session

// Arrays to hold question option data
String optionIds[4];
String optionTexts[4];
int totalOptions = 0;
int selectedAnswer = 0;
String currentQuestionId = "";
unsigned long long currentQuestionTimestamp = 0;

// Pointers to BLE characteristic objects
NimBLECharacteristic* pAuthCharacteristic;
NimBLECharacteristic* pQuestionCharacteristic;
NimBLECharacteristic* pQuestionClosedCharacteristic;
NimBLECharacteristic* pResponseCharacteristic;
NimBLECharacteristic* pSessionStatusCharacteristic;
NimBLECharacteristic* pTimeSyncCharacteristic;  // Time sync characteristic

// ----------------- Display Helper Functions -----------------

// Clear a specific line on the LCD
void clearLine(int line) {
  int yPos = line * 12;
  M5.Lcd.fillRect(0, yPos, 135, 12, BLACK);
  M5.Lcd.setCursor(0, yPos);
}

// Print a message on a given line
void logMessage(const char* msg, int line) {
  clearLine(line);
  M5.Lcd.setCursor(0, line * 12);
  M5.Lcd.print(msg);
}

// Display session information on the screen
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

// ----------------- BLE Callback Classes -----------------

// AuthCallbacks: Handles writes to the Auth characteristic.
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

// QuestionCallbacks: Handles writes to the Question characteristic.
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
  }
};

// QuestionClosedCallbacks: Handles writes to the Question Closed characteristic.
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

// SessionStatusCallbacks: Handles writes to the Session Status characteristic.
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
      logMessage(msg.c_str(), 8);  // Display status on line 8
      
      // If the status is "Completed", reset quiz state
      if(newStatus == "Completed") {
        joinedSession = false;
        questionActive = false;
        currentSessionId = "";
        expectedTapSequence = "";
        joinSequenceInput = "";
        totalOptions = 0;
        selectedAnswer = 0;
        currentQuestionId = "";
        currentQuestionTimestamp = 0;
        
        // Clear relevant display areas
        clearLine(2);
        clearLine(3);
        clearLine(4);
        clearLine(5);
        clearLine(6);
        Serial.println("Quiz state reset due to Completed status");
      }
    } else {
      Serial.print("Session status parse error: ");
      Serial.println(err.f_str());
    }
  }
};

// TimeSyncCallbacks: Handles writes to the Time Sync characteristic.
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

// ----------------- BLE Setup Function -----------------
// Initializes NimBLE, creates a service and its characteristics, and starts advertising.
void setupBLE() {
  NimBLEDevice::init("M5StickCPlus Quiz Client");
  NimBLEServer* pServer = NimBLEDevice::createServer();
  NimBLEService* pService = pServer->createService(QUIZ_SERVICE_UUID);
  
  // Create and set up the Auth characteristic
  pAuthCharacteristic = pService->createCharacteristic(
    AUTH_CHARACTERISTIC_UUID,
    NIMBLE_PROPERTY_READ | NIMBLE_PROPERTY_WRITE | NIMBLE_PROPERTY_NOTIFY
  );
  pAuthCharacteristic->setCallbacks(new AuthCallbacks());
  
  // Create and set up the Question characteristic
  pQuestionCharacteristic = pService->createCharacteristic(
    QUESTION_CHARACTERISTIC_UUID,
    NIMBLE_PROPERTY_READ | NIMBLE_PROPERTY_WRITE | NIMBLE_PROPERTY_NOTIFY
  );
  pQuestionCharacteristic->setCallbacks(new QuestionCallbacks());
  
  // Create and set up the Question Closed characteristic
  pQuestionClosedCharacteristic = pService->createCharacteristic(
    QUESTION_CLOSED_CHARACTERISTIC_UUID,
    NIMBLE_PROPERTY_READ | NIMBLE_PROPERTY_WRITE | NIMBLE_PROPERTY_NOTIFY
  );
  pQuestionClosedCharacteristic->setCallbacks(new QuestionClosedCallbacks());
  
  // Create the Response characteristic (for sending join/answer responses)
  pResponseCharacteristic = pService->createCharacteristic(
    RESPONSE_CHARACTERISTIC_UUID,
    NIMBLE_PROPERTY_WRITE | NIMBLE_PROPERTY_NOTIFY
  );
  
  // Create and set up the Session Status characteristic
  pSessionStatusCharacteristic = pService->createCharacteristic(
    SESSION_STATUS_CHARACTERISTIC_UUID,
    NIMBLE_PROPERTY_READ | NIMBLE_PROPERTY_WRITE | NIMBLE_PROPERTY_NOTIFY
  );
  pSessionStatusCharacteristic->setCallbacks(new SessionStatusCallbacks());
  
  // Create and set up the Time Sync characteristic
  pTimeSyncCharacteristic = pService->createCharacteristic(
    TIME_SYNC_CHARACTERISTIC_UUID,
    NIMBLE_PROPERTY_READ | NIMBLE_PROPERTY_WRITE | NIMBLE_PROPERTY_NOTIFY
  );
  pTimeSyncCharacteristic->setCallbacks(new TimeSyncCallbacks());
  
  // Start the service
  pService->start();
  
  // Set up advertising: add the service UUID and set scan response data.
  NimBLEAdvertising* pAdvertising = NimBLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(QUIZ_SERVICE_UUID);
  NimBLEAdvertisementData scanRespData;
  scanRespData.setName("QuizService");
  pAdvertising->setScanResponseData(scanRespData);
  pAdvertising->start();
  
  Serial.println("BLE Advertising started");
}

// ----------------- Time Sync Helper -----------------
// Returns the synchronized time using local millis() plus offset.
unsigned long long getSynchronizedTime() {
  return millis() + timeOffset;
}

// ----------------- Generate Random Client ID -----------------
// Generates a random client ID for display or identification.
String getRandomClientId() {
  String id = "m5stick_";
  for (int i = 0; i < 4; i++) {
    id += String(random(0xF), HEX);
  }
  return id;
}
String clientId = getRandomClientId();

// ----------------- Setup Function -----------------
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

// ----------------- Main Loop -----------------
// Handles button inputs to join sessions and send quiz responses.
void loop() {
  M5.update();
  
  // If not joined, allow tap sequence input via buttons.
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
    // Once the input length meets the expected tap sequence, validate it.
    if (expectedTapSequence.length() > 0 &&
      joinSequenceInput.length() >= expectedTapSequence.length()) {
      Serial.print("Expected tap sequence: ");
      Serial.println(expectedTapSequence);
      if (joinSequenceInput == expectedTapSequence) {
        // Prepare join payload JSON with action "join"
        StaticJsonDocument<200> joinDoc;
        joinDoc["action"] = "join";
        joinDoc["sessionId"] = currentSessionId;
        joinDoc["auth"] = joinSequenceInput;
        String joinPayload;
        serializeJson(joinDoc, joinPayload);
        // Write and notify the join payload on the response characteristic
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
  } else {
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
        // Prepare answer payload JSON with action "response"
        char payload[256];
        snprintf(payload, sizeof(payload),
                 "{\"action\":\"response\",\"questionId\":\"%s\",\"optionId\":\"%s\",\"timestamp\":%llu}",
                 currentQuestionId.c_str(), optionIds[selectedAnswer].c_str(), getSynchronizedTime());
        Serial.print("Sending answer payload: ");
        Serial.println(payload);
        std::string joinStr(payload, strlen(payload));
        pResponseCharacteristic->setValue(joinStr);
        pResponseCharacteristic->notify();
        logMessage("Answer sent", 7);
        delay(200);
      }
    }
  }
}
