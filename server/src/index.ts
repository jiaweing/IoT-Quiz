// server.ts
import cluster from "cluster";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Client as AedesClient } from "aedes";
import { createServer } from "aedes-server-factory";
import net from "net";
import os from "os";
import { require } from "./cjs-loader.js";
import { eq, and, sql, desc } from "drizzle-orm";
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
  authenticated: boolean;
}

const mq = process.env.MQ === "redis"
  ? require("mqemitter-redis")({
      port: process.env.REDIS_PORT,
    })
  : require("mqemitter-mongodb")({
      url: process.env.MONGO_URL,
    });

const persistence = process.env.PERSISTENCE === "redis"
  ? require("aedes-persistence-redis")({
      port: process.env.REDIS_PORT,
    })
  : require("aedes-persistence-mongodb")({
      url: process.env.MONGO_URL,
    });

// ----- CLUSTERING SETUP -----
if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  console.log(`Master ${process.pid} is running with ${numCPUs} CPUs`);

  // Fork a worker for each CPU.
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  
  cluster.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
  
} else {
  // ----- WORKER PROCESS: Initialize MQTT Broker and HTTP Server -----
  
  // Initialize Hono app for HTTP endpoints.
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
  const Aedes = require("aedes");
  const broker = Aedes({
    id: "BROKER_" + cluster.worker!.id,
    mq,
    persistence,
  });


  interface ExtendedAedesClient extends AedesClient {
    authenticated?: boolean;
  }

  // Authorize publish on "quiz/response" only for authenticated clients.
  broker.authorizePublish = (
    client: ExtendedAedesClient,
    packet: PublishPacket,
    callback: (error: Error | null) => void
  ): void => {
    const topic = packet.topic;
    if (topic.startsWith("quiz/response") && !client.authenticated) {
      return callback(new Error("Not authorized"));
    }
    callback(null);
  };
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
  broker.on("client", (client: ExtendedAedesClient) => {
    if (client.id === "frontend_dashboard") return;
    let clientIp = "unknown";
    if (client.conn) {
      const socket = client.conn as unknown as net.Socket;
      clientIp = socket.remoteAddress || "unknown";
    }
    // For simplicity, we use client.id as both deviceId and name.
    connectedClients.set(client.id, { id: client.id, ip: clientIp, deviceId: client.id, name: client.id, score: 0, authenticated:false });
    publishClientCount();
    broker.publish({
      topic: `system/client/${client.id}/info`,
      payload: Buffer.from(JSON.stringify({ id: client.id, ip: clientIp, authenticated: false })),
      qos: 1,
    });
    console.log(`[WS] Client connected: ${client.id} from ${clientIp} with authentication status: False`);
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
  broker.on("publish", async (packet: PublishPacket, client: ExtendedAedesClient | null) => {
    if (!client) return;
    const topic = packet.topic;
    const payloadStr = packet.payload.toString();
    // Handle quiz session join
    if (topic === "quiz/session/join") {
      if (activeSession == "active") {
        console.log(`[SECURITY] Reject join from ${client.id} – quiz already started.`);
        return;
      }
      let joinData;
      try {
        joinData = JSON.parse(payloadStr);
      } catch (e) {
        console.error("Failed to parse join payload:", e);
        return;
      }
      // Expect joinData to include sessionId and auth (the tap sequence)
      const sessionIdFromPayload: string = joinData.sessionId;
      const submittedSequence: string = joinData.auth;
      // Look up session in DB to get stored tapSequence
      const sessionInfo = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionIdFromPayload))
        .limit(1);
      if (sessionInfo.length === 0) {
        console.error("Session not found.");
        return;
      }
      const sessionRecord = sessionInfo[0];
      // Check that the submitted tap sequence matches the stored one
      if (submittedSequence !== sessionRecord.tapSequence) {
        console.error(`[SECURITY] Invalid tap sequence from ${client.id}.`);
        return;
      }
      // Register the client as a player
      const clientInfo = connectedClients.get(client.id);
      if (clientInfo) {
        clientInfo.session = sessionIdFromPayload;
        console.log(`[QUIZ] ${client.id} joined session: ${sessionIdFromPayload}`);
        try {
          const existing = await db
            .select()
            .from(players)
            .where(
              and(
                eq(players.deviceId, client.id),
                eq(players.sessionId, sessionIdFromPayload)
              )
            )
            .limit(1);
          if (existing.length === 0) {
            await db.insert(players).values({
              id: generateUUID(),
              sessionId: sessionIdFromPayload,
              deviceId: client.id,
              name: client.id,
              score: 0,
            });
          }
          clientInfo.authenticated = true
          // Mark client as authenticated for publishing responses.
          client.authenticated = true;
          broker.publish({
            topic: `system/client/${client.id}/info`,
            payload: Buffer.from(JSON.stringify({ id: client.id, ip: clientInfo.ip, authenticated: clientInfo.authenticated })),
            qos: 1,
          });
        } catch (error) {
          console.error("Failed to insert player into DB:", error);
        }
      }
      return;
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

          // Check if a response already exists for this user and question.
          const existingResponse = await db
          .select()
          .from(responses)
          .where(
            and(
              eq(responses.playerId, client.id),
              eq(responses.questionId, questionId),
              eq(responses.sessionId, activeSession)
            )
          )
          .limit(1);

          if (existingResponse.length > 0) {
            // Get previous points awarded for this response.
            const prevPoints = existingResponse[0].pointsAwarded || 0;
            // Adjust player's score by subtracting the old points.
            player.score -= prevPoints;

            const prevOptionId = existingResponse[0].optionId;
            const prevOptionResult = await db
            .select()
            .from(options)
            .where(eq(options.id, prevOptionId))
            .limit(1);
            if (prevOptionResult.length > 0) {
              const prevOrder = prevOptionResult[0].order;
              // Decrement the distribution count for the previous option.
              currentAnswerDistribution[String(prevOrder)] =
                Math.max(0, (currentAnswerDistribution[String(prevOrder)] || 0) - 1);
            }

            // Update the existing response record with the latest answer.
            await db.update(responses)
              .set({
                optionId: optionId,
                responseTime: computedResponseTime,
                isCorrect: isCorrect,
                pointsAwarded: pointsAwarded,
              })
              .where(eq(responses.id, existingResponse[0].id));
            console.log(`[QUIZ] Updated response for ${client.id}`);
          } else {
            // Insert a new response record.
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
          }

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
    const { sessionName, quizQuestions, tapSequence } = await c.req.json();
    if (!sessionName || !quizQuestions || !tapSequence) return c.text("Invalid payload", 400);

    const sessionId = generateUUID();
    // Insert a new session with default config
    await db.insert(sessions).values({
      id: sessionId,
      name: sessionName,
      status: "pending",
      tapSequence,
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


  // API Endpoint: Broadcast Auth Code – publishes the session's tap sequence to M5Stick devices.
  app.post("/api/quiz/auth", async (c) => {
    const { sessionId } = await c.req.json();
    if (!sessionId) return c.text("Session ID required", 400);

    // Retrieve the session record to get the tap sequence and session name.
    const sessionResult = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (sessionResult.length === 0) {
      return c.text("Session not found", 404);
    }
    const sessionRecord = sessionResult[0];
    const sessionName = sessionRecord.name;
    const tapSequence = sessionRecord.tapSequence;

    // Create payload with session details.
    const payload = JSON.stringify({ sessionId, sessionName, tapSequence });

    // Publish the auth payload to topic "quiz/auth"
    broker.publish({
      topic: "quiz/auth",
      payload: Buffer.from(payload),
      qos: 1,
    });
    console.log(`[QUIZ] Broadcasted auth code: ${payload}`);
    return c.json({ message: "Auth code broadcasted", sessionId });
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
    const leaderboard = await db
      .select()
      .from(players)
      .where(eq(players.sessionId, sessionId))
      .orderBy(desc(players.score)); // Sort by score in descending order
    return c.json(leaderboard);
  });

  // API Endpoint: End Quiz – broadcasts an end-of-quiz message.
  app.post("/api/quiz/end", async (c) => {
    const { sessionId } = await c.req.json();
    if (!sessionId) return c.text("Session ID required", 400);

    // Publish end-of-quiz payload on topic "quiz/end"
    const payload = JSON.stringify({ sessionId, message: "Quiz Ended" });
    broker.publish({
      topic: "quiz/end",
      payload: Buffer.from(payload),
      qos: 1,
    });
    console.log(`[QUIZ] End of quiz broadcast for session: ${sessionId}`);
    return c.json({ message: "Quiz ended", sessionId });
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

  console.log(`Worker ${process.pid} started and is handling MQTT and HTTP traffic.`);
}
