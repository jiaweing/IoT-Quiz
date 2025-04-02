import fs from "fs";
import { serve } from "@hono/node-server";
import { createServer as createHttpsServer } from "node:https";
import { WebSocketServer } from 'ws';
import https from 'https';
import { Hono } from "hono";
import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "@/db/db.js"; // Adjust the path as needed
import { sessions, questions, options, players, responses } from "@/db/schema.js";

// Import noble to act as a central device
import noble from "@abandonware/noble";

// --- Constants for Service and Characteristic UUIDs ---
const QUIZ_SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
const AUTH_CHARACTERISTIC_UUID = "abcdef01-1234-5678-1234-56789abcdef0";
const QUESTION_CHARACTERISTIC_UUID = "abcdef02-1234-5678-1234-56789abcdef0";
const QUESTION_CLOSED_CHARACTERISTIC_UUID = "abcdef03-1234-5678-1234-56789abcdef0";
const RESPONSE_CHARACTERISTIC_UUID = "abcdef04-1234-5678-1234-56789abcdef0";
const SCORE_CHARACTERISTIC_UUID = "abcdef05-1234-5678-1234-56789abcdef0";
const DISTRIBUTION_CHARACTERISTIC_UUID = "abcdef06-1234-5678-1234-56789abcdef0";
const SESSION_STATUS_CHARACTERISTIC_UUID = "abcdef07-1234-5678-1234-56789abcdef0";
const TIME_SYNC_CHARACTERISTIC_UUID = "abcdef08-1234-5678-1234-56789abcdef0";


// --- Utility: Simple UUID generator ---
function generateUUID() {
  return Date.now().toString(36) + '-' + Math.floor(Math.random() * 0xFFFFF).toString(36);
}

// --- Define a type for connected client devices ---
interface ClientDevice {
  id: string;
  peripheral: noble.Peripheral;
  characteristics: {
    auth?: noble.Characteristic;
    question?: noble.Characteristic;
    questionClosed?: noble.Characteristic;
    response?: noble.Characteristic;
    score?: noble.Characteristic;
    distribution?: noble.Characteristic;
    sessionStatus?: noble.Characteristic;
    timeSync?: noble.Characteristic; // New time sync characteristic
  };
  score: number;
  session?: string;
  name: string;
  authenticated: boolean;
}

// Store connected devices in a Map (keyed by peripheral.id)
const connectedClients = new Map<string, ClientDevice>();

// Active session and question tracking (as before)
let activeSession: string | null = null; // Active quiz session
let currentAnswerDistribution: { [key: string]: Set<string> } = { };
const questionTimestamps = new Map<string, number>();

let wss: WebSocketServer; // Will be assigned later

function broadcastWsMessage(type: string, payload: any) {
  const message = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    // @ts-ignore
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  });
}

noble.on("stateChange", (state) => {
    console.log("BLE state changed:", state);
    if (state === "poweredOn") {
      // Remove hyphens from UUIDs when comparing (noble returns lowercase without hyphens)
      const serviceUUID = QUIZ_SERVICE_UUID.replace(/-/g, "");
      noble.startScanning([serviceUUID], false);
      console.log("Scanning for Quiz peripherals...");
    } else {
      noble.stopScanning();
    }
});

// When a peripheral is discovered, check for our service and connect.
noble.on("discover", (peripheral) => {
    // Check if the peripheral's advertisement data contains our quiz service.
    const advServiceUuids = peripheral.advertisement.serviceUuids || [];
    if (advServiceUuids.includes(QUIZ_SERVICE_UUID.replace(/-/g, ""))) {
      console.log("Discovered Quiz peripheral:", peripheral.id);
      // Connect to the peripheral
      peripheral.connect((err) => {
        if (err) {
          console.error("Error connecting to peripheral:", err);
          return;
        }
        console.log("Connected to peripheral:", peripheral.id);
        // Discover our quiz service
        peripheral.discoverServices([QUIZ_SERVICE_UUID.replace(/-/g, "")], (err, services) => {
          if (err || services.length === 0) {
            console.error("Error discovering quiz service:", err);
            return;
          }
          const quizService = services[0];
          // Discover all characteristics of the quiz service
          quizService.discoverCharacteristics([], (err, characteristics) => {
            if (err) {
              console.error("Error discovering characteristics:", err);
              return;
            }
            // Create a mapping from characteristic UUID (without hyphens) to the characteristic instance
            const charMap = new Map<string, noble.Characteristic>();
            characteristics.forEach((char) => {
              charMap.set(char.uuid, char);
            });
            const device: ClientDevice = {
              id: peripheral.id,
              peripheral,
              characteristics: {
                auth: charMap.get(AUTH_CHARACTERISTIC_UUID.replace(/-/g, "")),
                question: charMap.get(QUESTION_CHARACTERISTIC_UUID.replace(/-/g, "")),
                questionClosed: charMap.get(QUESTION_CLOSED_CHARACTERISTIC_UUID.replace(/-/g, "")),
                response: charMap.get(RESPONSE_CHARACTERISTIC_UUID.replace(/-/g, "")),
                score: charMap.get(SCORE_CHARACTERISTIC_UUID.replace(/-/g, "")),
                distribution: charMap.get(DISTRIBUTION_CHARACTERISTIC_UUID.replace(/-/g, "")),
                sessionStatus: charMap.get(SESSION_STATUS_CHARACTERISTIC_UUID.replace(/-/g, "")),
                timeSync: charMap.get(TIME_SYNC_CHARACTERISTIC_UUID.replace(/-/g, "")), // New mapping
              },
              score: 0,
              name: peripheral.advertisement.localName || peripheral.id,
              authenticated: false,
            };
            connectedClients.set(peripheral.id, device);
            console.log("Stored device:", device.id, "with characteristics:", Object.keys(device.characteristics));
  
            // Subscribe to response notifications if available
            if (device.characteristics.response) {
              device.characteristics.response.subscribe((error) => {
                if (error) {
                  console.error("Error subscribing to response notifications:", error);
                }
              });
              device.characteristics.response.on("data", (data, isNotification) => {
                handleResponseData(device, data);
              });
            }
          });
        });
      });
  
      // Handle peripheral disconnect
      peripheral.on("disconnect", () => {
        console.log("Peripheral disconnected:", peripheral.id);
        connectedClients.delete(peripheral.id);
        const serviceUUID = QUIZ_SERVICE_UUID.replace(/-/g, "");
        noble.startScanning([serviceUUID], false);
      });
    }
  });

  // --- BLE Response Data Handler ---
// This function processes data received (via notifications) on the response characteristic.
function handleResponseData(device: ClientDevice, data: Buffer) {
  try {
    console.log("Received BLE response from", device.id, data.toString().trim());
    const payload = JSON.parse(data.toString().trim());
    console.log("Received BLE response from", device.id, payload);
    
    if (payload.action === "join") {
      if (activeSession === "active") {
        console.log(`[SECURITY] Reject join from ${device.id} – quiz already started.`);
        return;
      }
      const sessionIdFromPayload: string = payload.sessionId;
      const submittedSequence: string = payload.auth;
      // Look up session in DB
      db.select()
        .from(sessions)
        .where(eq(sessions.id, sessionIdFromPayload))
        .limit(1)
        .then((sessionInfo) => {
          if (sessionInfo.length === 0) {
            console.error("Session not found.");
            return;
          }
          const sessionRecord = sessionInfo[0];
          if (submittedSequence !== sessionRecord.tapSequence) {
            console.error(`[SECURITY] Invalid tap sequence from device ${device.id}.`);
            return;
          }
          // Mark the device as authenticated and record the session
          device.authenticated = true;
          device.session = sessionIdFromPayload;
          broadcastWsMessage("clientInfo", { id: device.id, connected: true, authenticated: true });
          broadcastWsMessage("clientCount", connectedClients.size);
          // Insert or update player record
          db.select()
            .from(players)
            .where(
              and(eq(players.deviceId, device.id), eq(players.sessionId, sessionIdFromPayload))
            )
            .limit(1)
            .then(async (existing) => {
              if (existing.length === 0) {
                await db.insert(players).values({
                  id: generateUUID(),
                  sessionId: sessionIdFromPayload,
                  deviceId: device.id,
                  name: device.name,
                  score: 0,
                });
              }
            })
            .catch((err) => console.error("DB error inserting player:", err));
        })
        .catch((err) => console.error("DB error retrieving session:", err));
    } else if (payload.action === "response") {
      if (!activeSession) return;
      if (device.session !== activeSession) return;
      (async () => {
        try {
          // Check for single-select vs. multi-select payload
          if (payload.optionId) {
            // ----- Single-select branch (unchanged) -----
            // Verify question exists
            const qResult = await db
              .select()
              .from(questions)
              .where(eq(questions.id, payload.questionId))
              .limit(1);
            if (qResult.length === 0) {
              console.error("Question not found in DB");
              return;
            }
            const questionRecord = qResult[0];
            // Verify option exists
            const optResult = await db
              .select()
              .from(options)
              .where(
                and(
                  eq(options.id, payload.optionId),
                  eq(options.questionId, payload.questionId)
                )
              )
              .limit(1);
            if (optResult.length === 0) {
              console.error("Option not found for the given question");
              return;
            }
            const optionRecord = optResult[0];
            const isCorrect = optionRecord.isCorrect;
            const maxAllowedTime = 30000; // 30 seconds in ms
            const questionBroadcastTimestamp = questionTimestamps.get(payload.questionId);
            let computedResponseTime = 0;
            if (questionBroadcastTimestamp) {
              computedResponseTime = Number(payload.timestamp) - questionBroadcastTimestamp;
            } else {
              console.log("Computed response time: ERROR");
            }
            console.log("Computed response time:", computedResponseTime);
            if (computedResponseTime > maxAllowedTime) {
              console.log(
                `[QUIZ] ${device.id} answered too late (${computedResponseTime} ms). Ignoring response.`
              );
              return;
            }
            const timeFactor = 1 - (computedResponseTime / maxAllowedTime);
            const pointsAwarded = isCorrect ? Math.round(questionRecord.points * timeFactor) : 0;
            const existingResponse = await db
              .select()
              .from(responses)
              .where(
                and(
                  eq(responses.playerId, device.id),
                  eq(responses.questionId, payload.questionId),
                  eq(responses.sessionId, activeSession)
                )
              )
              .limit(1);
            if (existingResponse.length > 0) {
              const prevPoints = existingResponse[0].pointsAwarded || 0;
              device.score -= prevPoints;
              const prevOptionId = existingResponse[0].optionId;
              if (currentAnswerDistribution[prevOptionId]) {
                currentAnswerDistribution[prevOptionId].delete(device.id);
              }
              await db
                .update(responses)
                .set({
                  optionId: payload.optionId,
                  responseTime: computedResponseTime,
                  isCorrect: isCorrect,
                  pointsAwarded: pointsAwarded,
                })
                .where(eq(responses.id, existingResponse[0].id));
              console.log(`[QUIZ] Updated response for ${device.id}`);
            } else {
              await db.insert(responses).values({
                id: generateUUID(),
                sessionId: activeSession,
                questionId: payload.questionId,
                playerId: device.id,
                optionId: payload.optionId,
                responseTime: computedResponseTime,
                isCorrect,
                pointsAwarded,
              });
            }
            if (isCorrect) {
              device.score += pointsAwarded;
            }
            await db
              .update(players)
              .set({ score: device.score })
              .where(eq(players.deviceId, device.id));
            broadcastWsMessage("score", { id: device.id, score: device.score });
            currentAnswerDistribution[optionRecord.id].add(device.id);
            const distributionToPublish: { [key: string]: number } = {};
            const unionSet = new Set<string>();
            for (const [optId, clientSet] of Object.entries(currentAnswerDistribution)) {
              distributionToPublish[optId] = clientSet.size;
              for (const cid of clientSet) {
                unionSet.add(cid);
              }
            }
            const uniqueRespondents = unionSet.size;
            broadcastWsMessage("distribution", { distribution: distributionToPublish, uniqueRespondents });
            console.log(
              `[QUIZ] ${device.id} answered ${isCorrect ? "correctly" : "incorrectly"}. New score: ${device.score}`
            );
          } else if (payload.optionIds) {
            // ----- Multi-select branch -----
            const submittedOptionIds: string[] = payload.optionIds;
            // Retrieve the question record.
            const qResult = await db
              .select()
              .from(questions)
              .where(eq(questions.id, payload.questionId))
              .limit(1);
            if (qResult.length === 0) {
              console.error("Question not found in DB");
              return;
            }
            const questionRecord = qResult[0];
            // Retrieve correct options (where isCorrect is true)
            const correctOptionsResult = await db
              .select()
              .from(options)
              .where(and(eq(options.questionId, payload.questionId), eq(options.isCorrect, true)));
            const correctOptionIds: string[] = correctOptionsResult.map((opt: any) => opt.id);
            // Sort both arrays for comparison.
            submittedOptionIds.sort();
            correctOptionIds.sort();
            const exactMatch = JSON.stringify(submittedOptionIds) === JSON.stringify(correctOptionIds);
            const maxAllowedTime = 30000;
            const questionBroadcastTimestamp = questionTimestamps.get(payload.questionId);
            let computedResponseTime = 0;
            if (questionBroadcastTimestamp) {
              computedResponseTime = Number(payload.timestamp) - questionBroadcastTimestamp;
            } else {
              console.log("Computed response time: ERROR");
            }
            const timeFactor =
              computedResponseTime < maxAllowedTime ? 1 - (computedResponseTime / maxAllowedTime) : 0;
            const allocatedPoints = questionRecord.points || 0;
            const pointsAwarded = exactMatch ? Math.round(allocatedPoints * timeFactor) : 0;
            // Retrieve any existing multi-select responses for this player and question.
            const existingResponses = await db
              .select()
              .from(responses)
              .where(
                and(
                  eq(responses.playerId, device.id),
                  eq(responses.questionId, payload.questionId),
                  eq(responses.sessionId, activeSession)
                )
              ).limit(1);
            console.log("Existing response result:", existingResponses);
            let prevPoints = 0;
            for (const resp of existingResponses) {
              prevPoints += resp.pointsAwarded || 0;
            }
            const delta = pointsAwarded - prevPoints;
            device.score += delta;
            if (device.score < 0) device.score = 0;
            if (existingResponses.length > 0) {
              // Remove previous multi-select responses.
              await db.delete(responses)
                .where(
                  and(
                    eq(responses.playerId, device.id),
                    eq(responses.questionId, payload.questionId),
                    eq(responses.sessionId, activeSession)
                  )
                );
            }
            // Insert a row for each submitted option.
            for (const optId of submittedOptionIds) {
              await db.insert(responses).values({
                id: generateUUID(),
                sessionId: activeSession,
                questionId: payload.questionId,
                playerId: device.id,
                optionId: optId,
                responseTime: computedResponseTime,
                isCorrect: exactMatch, // Mark as correct only if the submission exactly matches.
                pointsAwarded: exactMatch ? pointsAwarded : 0,
              });
            }
            await db
              .update(players)
              .set({ score: device.score })
              .where(eq(players.deviceId, device.id));
            broadcastWsMessage("score", { id: device.id, score: device.score });
            // Update answer distribution for each submitted option.
            for (const [optId, clientSet] of Object.entries(currentAnswerDistribution)) {
              clientSet.delete(device.id);
            }
            for (const optId of submittedOptionIds) {
              if (currentAnswerDistribution[optId]) {
                currentAnswerDistribution[optId].add(device.id);
              }
            }
            const distributionToPublish: { [key: string]: number } = {};
            const unionSet = new Set<string>();
            for (const [optId, clientSet] of Object.entries(currentAnswerDistribution)) {
              distributionToPublish[optId] = clientSet.size;
              for (const cid of clientSet) {
                unionSet.add(cid);
              }
            }
            const uniqueRespondents = unionSet.size;
            broadcastWsMessage("distribution", { distribution: distributionToPublish, uniqueRespondents });
            console.log(
              `[QUIZ] ${device.id} multi-select processed. Exact match: ${exactMatch}, Points: ${pointsAwarded}`
            );
          } else {
            console.error("No valid option field in response payload.");
          }
        } catch (dbErr) {
          console.error("DB Error processing quiz response:", dbErr);
        }
      })();
    } else {
      console.error("Unknown action in BLE response payload.");
    }
  } catch (err) {
    console.error("Error handling response data:", err);
  }
}


// --- Helper to update a given characteristic on all connected devices ---
function updateCharacteristicOnAllClients(
    characteristicName: keyof ClientDevice["characteristics"],
    data: any
  ) {
    const buffer = Buffer.from(typeof data === "string" ? data : JSON.stringify(data));
    connectedClients.forEach((device) => {
      const char = device.characteristics[characteristicName];
      if (char) {
        char.write(buffer, false, (err) => {
          if (err) {
            console.error(`Error writing to ${characteristicName} for device ${device.id}:`, err);
          } else {
            console.log(`Updated ${characteristicName} ${char} for device ${device.id}`);
          }
        });
      }
    });
}

  const app = new Hono();

// CORS Middleware
app.use("*", async (c, next) => {
  await next();
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");
});
app.options("*", (c) => {
  return new Response(null, {
    status: 204,
    headers: new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }),
  });
});

app.use("*", async (c, next) => {
  await next();
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");
});
app.options("*", (c) => {
  return new Response(null, {
    status: 204,
    headers: new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }),
  });
});

// API Endpoint: Create Quiz – creates a session, questions, and options
app.post("/api/quiz/create", async (c) => {
    const { sessionName, quizQuestions, tapSequence } = await c.req.json();
    if (!sessionName || !quizQuestions || !tapSequence) return c.text("Invalid payload", 400);
  
    const sessionId = generateUUID();
    await db.insert(sessions).values({
      id: sessionId,
      name: sessionName,
      status: "pending",
      tapSequence,
    });
  
    // Insert questions and options
    for (let i = 0; i < quizQuestions.length; i++) {
      const q = quizQuestions[i];
      const questionId = generateUUID();
      await db.insert(questions).values({
        id: questionId,
        sessionId,
        text: q.questionText,
        type: q.type, 
        order: i + 1,
      });
  
      // Handle correct answers based on question type
      if (q.type === "multi_select" && q.correctAnswers) {
        // For multi-select questions, use the correctAnswers array
        for (let j = 0; j < q.answers.length; j++) {
          const optionText = q.answers[j];
          await db.insert(options).values({
            id: generateUUID(),
            questionId,
            text: optionText,
            isCorrect: q.correctAnswers[j],
            order: j + 1,
          });
        }
      } else {
        // For single-select questions, use the correctAnswerIndex
        for (let j = 0; j < q.answers.length; j++) {
          const optionText = q.answers[j];
          await db.insert(options).values({
            id: generateUUID(),
            questionId,
            text: optionText,
            isCorrect: j === q.correctAnswerIndex,
            order: j + 1,
          });
        }
      }
    }
    console.log(`[QUIZ] Quiz created: ${sessionName} with sessionId: ${sessionId}`);
    return c.json({ message: "Quiz created", sessionId });
});

  // API Endpoint: Broadcast Auth Code – sends session details to all connected peripherals.
app.post("/api/quiz/auth", async (c) => {
    const { sessionId } = await c.req.json();
    if (!sessionId) return c.text("Session ID required", 400);
  
    const sessionResult = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (sessionResult.length === 0) {
      return c.text("Session not found", 404);
    }
    const sessionRecord = sessionResult[0];
    const sessionName = sessionRecord.name;
    const tapSequence = sessionRecord.tapSequence;
  
    const payload = { sessionId, sessionName, tapSequence };
    updateCharacteristicOnAllClients("auth", payload);
    console.log(`[QUIZ] Broadcasted auth code: ${JSON.stringify(payload)}`);
    return c.json({ message: "Auth code broadcasted", sessionId });
});
  

  // API Endpoint: Start Quiz Session – activates the session and resets answer distribution
app.post("/api/quiz/start", async (c) => {
    const { sessionId } = await c.req.json();
    if (!sessionId) return c.text("Session ID required", 400);
  
    activeSession = sessionId;
    await db.update(sessions).set({ status: "active" }).where(eq(sessions.id, sessionId));
  
    const sessionResult = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    const sessionName = sessionResult[0]?.name || "";
    console.log(`[QUIZ] Session started: ${sessionName}`);
  
    // Broadcast the first question (question index 0)
    await broadcastCurrentQuestion(sessionId, 0);

    broadcastWsMessage("sessionStatus", { status: "active", sessionId, sessionName });
  
    return c.json({ message: "Quiz session started", sessionId });
});

// API Endpoint: Broadcast Next Question
app.post("/api/quiz/broadcast", async (c) => {
    const { sessionId, questionIndex } = await c.req.json();
    if (!sessionId) return c.text("Session ID required", 400);
    const index = questionIndex ?? 0;
    await broadcastCurrentQuestion(sessionId, index);
    console.log(`[QUIZ] Broadcasted question index ${index} for session ${sessionId}`);
    return c.json({ message: "Question broadcasted", questionIndex: index });
});

  // API Endpoint: Retrieve Leaderboard (by session)
app.get("/api/quiz/leaderboard", async (c) => {
    const sessionId = c.req.query("sessionId");
    if (!sessionId) return c.text("Session ID required", 400);
    const leaderboard = await db
      .select()
      .from(players)
      .where(eq(players.sessionId, sessionId))
      .orderBy(desc(players.score));
    return c.json(leaderboard);
});

// API Endpoint: End Quiz – broadcasts an end-of-quiz message.
app.post("/api/quiz/end", async (c) => {
    const { sessionId } = await c.req.json();
    if (!sessionId) return c.text("Session ID required", 400);
  
    const payload = { sessionId, status: "Completed" };
    await db.update(sessions).set({ status: "Completed" }).where(eq(sessions.id, sessionId));
    updateCharacteristicOnAllClients("sessionStatus", payload);
    // Optionally clear out previous data on the connected devices
    updateCharacteristicOnAllClients("auth", {});
    updateCharacteristicOnAllClients("question", {});
    broadcastWsMessage("sessionStatus", payload);
    console.log(`[QUIZ] End of quiz broadcast for session: ${sessionId}`);
    return c.json({ message: "Quiz ended", sessionId });
});

// API Endpoint: Reset Scores – resets the score for all players in a session to 0
app.post("/api/quiz/reset-quiz", async (c) => {
  const { sessionId } = await c.req.json();
  if (!sessionId) return c.text("Session ID required", 400);

  // Update all players in the DB for this session to have a score of 0.
  await db.update(players)
    .set({ score: 0 })
    .where(eq(players.sessionId, sessionId));

  // Filter connected devices that belong to the session and update their score property.
  connectedClients.forEach((device) => {
    if (device.session === sessionId && device.characteristics.score) {
      device.score = 0;
      const payload = { id: device.id, score: 0 };
      device.characteristics.score.write(
        Buffer.from(JSON.stringify(payload)),
        false,
        (err) => {
          if (err) {
            console.error(`Error updating score for device ${device.id}:`, err);
          } else {
            console.log(`Score reset for device ${device.id}`);
          }
        }
      );
    }
  });

  return c.json({ message: "Quiz scores reset", sessionId });
});



// --- Helper: Broadcast Current Question ---
async function broadcastCurrentQuestion(sessionId: string, questionIndex: number = 0) {
    const totalQuestionsResult = await db
      .select({ count: sql`count(*)` })
      .from(questions)
      .where(eq(questions.sessionId, sessionId));
    const totalQuestions = Number(totalQuestionsResult[0].count);
  
    if (questionIndex >= totalQuestions) {
      console.error("No question found for the current index; quiz is finished.");
      return;
    }
    
    const questionResult = await db
      .select()
      .from(questions)
      .where(eq(questions.sessionId, sessionId))
      .orderBy(questions.order)
      .limit(1)
      .offset(questionIndex);
    
    if (questionResult.length === 0) {
      console.error("No question found for the current index");
      return;
    }
    const questionData = questionResult[0];
    const optionsResult = await db
      .select()
      .from(options)
      .where(eq(options.questionId, questionData.id))
      .orderBy(options.order);
  
    currentAnswerDistribution = {};
    optionsResult.forEach((opt: any) => {
      currentAnswerDistribution[opt.id] = new Set();
    });

    const broadcastTimestamp = Date.now();
    questionTimestamps.set(questionData.id, broadcastTimestamp);

    const correctOptionIds = optionsResult.filter((opt:any) => opt.isCorrect).map((opt:any) => opt.id);
    const payload = {
      id: questionData.id,
      text: questionData.text,
      type: questionData.type,
      options: optionsResult.map(opt => ({ id: opt.id, text: opt.text })),
      correctOptionIds,
      timestamp: broadcastTimestamp
    };
  
    updateCharacteristicOnAllClients("question", payload);
    broadcastWsMessage("question", payload);
  
    // Broadcast question closed data shortly after (as in your original code)
    setTimeout(() => {
        const closePayload = { questionId: questionData.id, closedAt: Date.now() };
        updateCharacteristicOnAllClients("questionClosed", closePayload);
        console.log(`[QUIZ] Broadcasted question: ${questionData.id}`);
    }, 30000);
    
    console.log(`[QUIZ] Broadcasted question: ${questionData.id}`);
}

const webserverPort = 3001;
const websocketPort = 8443; // Standard secure Websocket port

const httpsOptions = {
  key: fs.readFileSync("./certificates/https-key.pem"),
  cert: fs.readFileSync("./certificates/https.pem"),
  ca: fs.readFileSync("./certificates/rootCA.pem"),
} 

const server = https.createServer(httpsOptions);
wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("WebSocket client connected");

  ws.on("close", () => {
    console.log("WebSocket client disconnected");
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });
});

server.listen(websocketPort, () => {
  console.log("Secure WebSocket server listening on port 8443");
});

setInterval(() => {
  const payload = { serverTime: Date.now() };
  updateCharacteristicOnAllClients("timeSync", payload);
}, 1000);

// HTTP Routes
app.get("/", (c) => {
  return c.text("Webserver & Bluetooth Server are running");
});


// Start secure web server for API Calls
serve({ fetch: app.fetch, createServer: createHttpsServer, 
  serverOptions: httpsOptions, port: webserverPort });