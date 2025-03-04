// server.ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Client as AedesClient } from "aedes";
import { createServer } from "aedes-server-factory";
import net from "net";
import os from "os";
import { require } from "./cjs-loader.js";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/db/db.js"; // Adjust the path as needed
import { sessions, questions, options, players, responses } from "@/db/schema.js";

// Simple UUID generator
function generateUUID() {
  // Convert current time to base36 and append a random number in base36.
  return Date.now().toString(36) + '-' + Math.floor(Math.random() * 0xFFFFF).toString(36);
}

interface PublishPacket {
  topic: string;
  payload: Buffer;
  client?: { id: string };
}

interface ClientData {
  id: string;
  ip: string;
  session?: string;
  deviceId: string;
  name: string;
  score: number;
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

// MQTT Broker & In-Memory Tracking
const broker = require("aedes")();
const connectedClients = new Map<string, ClientData>();
let activeSession: string | null = null; // Active quiz session
let currentAnswerDistribution: { [key: string]: number } = { "1": 0, "2": 0, "3": 0, "4": 0 };
const questionTimestamps = new Map<string, number>();

// Helper function to broadcast current question details
async function broadcastCurrentQuestion(sessionId: string, questionIndex: number = 0) {
   // Get total number of questions for the session.
   const totalQuestionsResult = await db
   .select({ count: sql`count(*)` })
   .from(questions)
   .where(eq(questions.sessionId, sessionId));
 const totalQuestions = Number(totalQuestionsResult[0].count);

 if (questionIndex >= totalQuestions) {
   console.error("No question found for the current index; quiz is finished.");
   return;
 }
  
  // Retrieve the question for the session, ordered by "order"
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

  // Fetch options for the question ordered by "order"
  const optionsResult = await db
    .select()
    .from(options)
    .where(eq(options.questionId, questionData.id))
    .orderBy(options.order);

  // Reset answer distribution for new question (keys "1" to "4")
  currentAnswerDistribution = { "1": 0, "2": 0, "3": 0, "4": 0 }

  const broadcastTimestamp = Date.now();
  
  // Record the broadcast timestamp for this question
  questionTimestamps.set(questionData.id, broadcastTimestamp);

  const payload = {
    id: questionData.id,
    text: questionData.text,
    options: optionsResult.map(opt => ({ id: opt.id, text: opt.text })),
    timestamp: broadcastTimestamp
  };

  // Publish the question details to topic "quiz/question"
  broker.publish({
    topic: "quiz/question",
    payload: Buffer.from(JSON.stringify(payload)),
    qos: 1,
  });

  // In broadcastCurrentQuestion() after broadcasting the question:
  setTimeout(() => {
    const closePayload = { questionId: questionData.id, closedAt: Date.now() };
    broker.publish({
      topic: "quiz/question/closed",
      payload: Buffer.from(JSON.stringify(closePayload)),
      qos: 1,
    });
    console.log(`[QUIZ] Closed question: ${questionData.id}`);
  }, 30000);

  console.log(`[QUIZ] Broadcasted question: ${questionData.id}`);
}

// Publish the connected clients count to topic "system/client_count"
function publishClientCount() {
  setTimeout(() => {
    const count = Array.from(connectedClients.keys()).filter(
      (id) => id !== "frontend_dashboard"
    ).length;
    broker.publish({
      topic: "system/client_count",
      payload: Buffer.from(count.toString()),
      qos: 1,
    });
  }, 500);
}

// Function to publish server time for synchronization
function publishTimeSync() {
  setInterval(() => {
      const serverTime = Date.now(); // Get server time in milliseconds
      broker.publish({
          topic: "system/time/sync",
          payload: Buffer.from(JSON.stringify({ serverTime })),
          qos: 1,
      });
      // console.log(`[SYNC] Server time published: ${serverTime}`);
  }, 1000); // Broadcast every 5 seconds
}

publishTimeSync();


// MQTT: Track client connections
broker.on("client", (client: AedesClient) => {
  if (client.id === "frontend_dashboard") return;
  let clientIp = "unknown";
  if (client.conn) {
    const socket = client.conn as unknown as net.Socket;
    clientIp = socket.remoteAddress || "unknown";
  }
  // For simplicity, we use client.id as both deviceId and name.
  connectedClients.set(client.id, { id: client.id, ip: clientIp, deviceId: client.id, name: client.id, score: 0 });
  publishClientCount();
  broker.publish({
    topic: `system/client/${client.id}/info`,
    payload: Buffer.from(JSON.stringify({ id: client.id, ip: clientIp })),
    qos: 1,
  });
  console.log(`[WS] Client connected: ${client.id} from ${clientIp}`);
});

broker.on("clientDisconnect", (client: AedesClient) => {
  connectedClients.delete(client.id);
  publishClientCount();
  broker.publish({
    topic: `system/client/${client.id}/disconnect`,
    payload: Buffer.from(client.id),
    qos: 1,
  });
  if (client.id !== "frontend_dashboard") {
    console.log(`[WS] Client disconnected: ${client.id}`);
  }
});

// MQTT: Handle incoming messages
broker.on("publish", (packet: PublishPacket, client: AedesClient | null) => {
  if (!client) return;
  const topic = packet.topic;
  const payloadStr = packet.payload.toString();

  // Handle quiz session join
  if (topic === "quiz/session/join") {
    if (!activeSession) return;
    const clientInfo = connectedClients.get(client.id);
    if (clientInfo) {
      clientInfo.session = activeSession;
      console.log(`[QUIZ] ${client.id} joined session: ${activeSession}`);

      // Insert a new player record into the DB using the players table.
      (async () => {
        try {
          // Check if player already exists for this session.
          const existing = await db
            .select()
            .from(players)
            .where(
              and(
                eq(players.deviceId, client.id),
                eq(players.sessionId, activeSession)
              )
            )
            .limit(1);
          if (existing.length === 0) {
            await db.insert(players).values({
              id: generateUUID(),
              sessionId: activeSession,
              deviceId: client.id,
              name: client.id, // For demo, using client.id
              score: 0,
            });
          }
        } catch (error) {
          console.error("Failed to insert player into DB:", error);
        }
      })();
    }
  }

  // Handle quiz responses
  if (topic === "quiz/response") {
    if (!activeSession) return;
    const player = connectedClients.get(client.id);
    if (!player || player.session !== activeSession) return;
    
    let answerObj;
    try {
      answerObj = JSON.parse(payloadStr);
    } catch (e) {
      console.error("Failed to parse quiz response payload:", e);
      return;
    }
    const { questionId, optionId, timestamp} = answerObj;
    console.log("Received response for question id: ", questionId);
    console.log("Received option id: ", optionId);
    console.log("Received client timestamp: ", timestamp);
    (async () => {
      try {
         // Fetch the question record to verify the question exists.
        const qResult = await db
          .select()
          .from(questions)
          .where(eq(questions.id, questionId))
          .limit(1);
        if (qResult.length === 0) {
          console.error("Question not found in DB");
          return;
        }
        const questionRecord = qResult[0];

        // Fetch the option record to determine if it is correct.
        const optResult = await db
          .select()
          .from(options)
          .where(
            and(
              eq(options.id, optionId),
              eq(options.questionId, questionId)
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
        const questionBroadcastTimestamp = questionTimestamps.get(questionId);
        let computedResponseTime = 0;
        if (questionBroadcastTimestamp) {
          // Calculate reaction time using the client's synchronized response timestamp.
          computedResponseTime = Number(timestamp) - questionBroadcastTimestamp;
        } else {
          console.log("Computed response time: ERROR");
        }
        console.log("Computed response time: ", computedResponseTime);

        // Ignore responses after 30 seconds
        if (computedResponseTime > maxAllowedTime) {
          console.log(`[QUIZ] ${client.id} answered too late (${computedResponseTime} ms). Ignoring response.`);
          return;
        }

        // Compute time factor: 0 ms => factor 1, 30000 ms => factor 0.
        const timeFactor = 1 - (computedResponseTime / maxAllowedTime);
        // Award points if the answer is correct.
        const pointsAwarded = isCorrect ? Math.round(questionRecord.points * timeFactor) : 0;

        if (isCorrect) {
          player.score += pointsAwarded;
        }

        // Update the player's score in the database.
        await db.update(players)
        .set({ score: player.score })
        .where(eq(players.deviceId, client.id));

        broker.publish({
          topic: `quiz/player/${client.id}/score`,
          payload: Buffer.from(JSON.stringify({ id: client.id, score: player.score })),
          qos: 1,
        });

        // Insert the response into the DB.
        await db.insert(responses).values({
          id: generateUUID(),
          sessionId: activeSession,
          questionId,
          playerId: client.id,
          optionId,
          responseTime: computedResponseTime,
          isCorrect,
          pointsAwarded,
        });

        // Update answer distribution based on the option's order.
        const optionOrder = optionRecord.order; // DB stored order (j+1)
        currentAnswerDistribution[optionOrder.toString()] =
        (currentAnswerDistribution[optionOrder.toString()] || 0) + 1;
        broker.publish({
          topic: "quiz/answers/distribution",
          payload: Buffer.from(JSON.stringify(currentAnswerDistribution)),
          qos: 1,
        });

        console.log(`[QUIZ] ${client.id} answered ${isCorrect ? "correctly" : "incorrectly"}. New score: ${player.score}`);
      } catch (dbErr) {
        console.error("DB Error processing quiz response:", dbErr);
      }
    })();
  }
});

// API Endpoint: Create Quiz – creates a session, questions, and options
app.post("/api/quiz/create", async (c) => {
  const { sessionName, quizQuestions } = await c.req.json();
  if (!sessionName || !quizQuestions) return c.text("Invalid payload", 400);

  const sessionId = generateUUID();
  // Insert a new session with default config
  await db.insert(sessions).values({
    id: sessionId,
    name: sessionName,
    status: "pending",
  });

  // Insert questions and their options
  for (let i = 0; i < quizQuestions.length; i++) {
    const q = quizQuestions[i];
    const questionId = generateUUID();
    await db.insert(questions).values({
      id: questionId,
      sessionId,
      text: q.questionText,
      // Using defaults for type, points, and timeLimit (can be customized)
      order: i + 1,
    });
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
  console.log(`[QUIZ] Quiz created: ${sessionName} with sessionId: ${sessionId}`);
  return c.json({ message: "Quiz created", sessionId });
});

// API Endpoint: Start Quiz Session – activates the session and resets answer distribution
app.post("/api/quiz/start", async (c) => {
  const { sessionId } = await c.req.json();
  if (!sessionId) return c.text("Session ID required", 400);

  activeSession = sessionId;

  // Update session status to "active"
  await db.update(sessions)
    .set({ status: "active" })
    .where(eq(sessions.id, sessionId));

  // Retrieve session name for broadcasting
  const sessionResult = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  const sessionName = sessionResult[0]?.name || "";

  broker.publish({
    topic: "quiz/session/start",
    payload: Buffer.from(sessionName),
    qos: 1,
  });
  console.log(`[QUIZ] Session started: ${sessionName}`);
  
  // Broadcast the first question (question index 0)
  await broadcastCurrentQuestion(sessionId, 0);
  
  return c.json({ message: "Quiz session started", sessionId });
});

// API Endpoint: Broadcast Next Question
app.post("/api/quiz/broadcast", async (c) => {
  const { sessionId, questionIndex } = await c.req.json();
  if (!sessionId) return c.text("Session ID required", 400);
  // Use provided questionIndex or default to 0.
  const index = questionIndex ?? 0;
  await broadcastCurrentQuestion(sessionId, index);
  console.log(`[QUIZ] Broadcasted question index ${index} for session ${sessionId}`);
  return c.json({ message: "Question broadcasted", questionIndex: index });
});

// API Endpoint: Retrieve Leaderboard (by session)
app.get("/api/quiz/leaderboard", async (c) => {
  const sessionId = c.req.query("sessionId");
  if (!sessionId) return c.text("Session ID required", 400);
  const leaderboard = await db.select().from(players).where(eq(players.sessionId, sessionId));
  return c.json(leaderboard);
});

// Networking Configuration
const mqttPort = 8888;
const mqttTcpPort = 1883;
const webserverPort = 3001;

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]!) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

// Start MQTT WebSocket server
const httpServer = createServer(broker, { ws: true });
httpServer.listen(mqttPort, () => {
  console.log("WebSocket MQTT server running on port:", mqttPort);
});

// Start MQTT TCP server
const tcpServer = net.createServer(broker.handle);
tcpServer.listen(mqttTcpPort, () => {
  console.log("[TCP] MQTT server listening on", getLocalIpAddress() + ":" + mqttTcpPort);
});
tcpServer.on("connection", (socket) => {
  console.log("[TCP] New client connection from:", socket.remoteAddress);
});
tcpServer.on("close", () => {
  console.log("[TCP] Server closed");
});
tcpServer.on("error", (err) => {
  console.error("[TCP] Error:", err);
});

// HTTP Routes
app.get("/", (c) => {
  return c.text("Webserver & MQTT Server are running");
});

serve({ fetch: app.fetch, port: webserverPort });
