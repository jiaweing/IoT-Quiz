// server.ts
import cluster from "cluster";
import tls from "tls";
import fs from "fs";
import { serve } from "@hono/node-server";
import { createServer as createHttpsServer } from 'node:https'
import { Hono } from "hono";
import type { Client as AedesClient } from "aedes";
import { createServer } from "aedes-server-factory";
import net from "net";
import os from "os";
import path from "path";
import { fileURLToPath } from 'url';
import { require } from "./cjs-loader.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "@/db/db.js"; // Adjust the path as needed
import { sessions, questions, options, players, responses, deviceCredentials, students } from "@/db/schema.js";

// Simple UUID generator
function generateUUID() {
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
  name?: string;
  score: number;
  authenticated: boolean;
  authorized: boolean;
  studentId?: string;
}

// Logging Latency and Delivery Rate
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const latencyLogPath = path.join(__dirname, "mqtt_latency_log.csv");
const deliveryLogPath = path.join(__dirname, "mqtt_delivery_log.csv");

// Initialize latency log
if (!fs.existsSync(latencyLogPath)) {
  fs.writeFileSync(latencyLogPath, "timestamp,client_id,question_id,latency_ms\n");
}

// Initialize delivery log
if (!fs.existsSync(deliveryLogPath)) {
  fs.writeFileSync(deliveryLogPath, "timestamp,question_id,expected_responses,received_responses,delivery_rate\n");
}

// Packet delivery tracking
const deliveryTracker: {
  sessionId: string;
  totalExpected: number;
  receivedCount: number;
} = {
  sessionId: "",
  totalExpected: 0,
  receivedCount: 0,
};

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
    authorized?: boolean;
  }

      // Add this after broker initialization
  broker.authenticate = (client: ExtendedAedesClient,
  username: Buffer | string | undefined,
  password: Buffer | string | undefined,
  callback: (error: Error | null, success: boolean) => void) => {
    // Allow frontend dashboard to connect without authentication
    if (client.id === "frontend_dashboard") {
      console.log("[AUTH] Dashboard client authenticated automatically");
      client.authenticated = true;
      return callback(null, true);
    }
  
    // Skip authentication during development if needed
    // return callback(null, true);
    
    if (!username || !password) {
      console.log(`[AUTH] Missing credentials for client ${client.id}`);
      return callback(new Error("Username and password required"), false);
    }
  
    const usernameStr = username.toString();
    const passwordStr = password.toString();
    
    console.log(`[AUTH] Authenticating client ${client.id} with username: ${usernameStr}`);
    
    // Check credentials against database
    db.select()
      .from(deviceCredentials)
      .where(
        and(
          eq(deviceCredentials.macAddress, usernameStr),
          eq(deviceCredentials.password, passwordStr),
          eq(deviceCredentials.isActive, true)
        )
      )
      .limit(1)
      .then((results) => {
        if (results.length > 0) {
          console.log(`[AUTH] Client ${client.id} authenticated successfully`);
          client.authenticated = true;
          const studentId = results[0].studentId;
          let cInfo = connectedClients.get(client.id);
          if (cInfo) {
            cInfo.studentId = studentId;
          } else {
            // If no record exists, create one.
            cInfo = { id: client.id, ip: "unknown", deviceId: client.id, score: 0, authenticated: true, authorized: false, studentId };
            connectedClients.set(client.id, cInfo);
          }
          console.log("Student ID", cInfo?.studentId);
          return callback(null, true);
        } else {
          console.log(`[AUTH] Invalid credentials for client ${client.id}`);
          return callback(new Error("Invalid credentials"), false);
        }
      })
      .catch((error) => {
        console.error(`[AUTH] Database error:`, error);
        return callback(new Error("Authentication error"), false);
      });
  };

  // Authorize publish on "quiz/response" only for authorized clients.
  broker.authorizePublish = (
    client: ExtendedAedesClient,
    packet: PublishPacket,
    callback: (error: Error | null) => void
  ): void => {
    const topic = packet.topic;
    if (topic.startsWith("quiz/response") && !client.authorized) {
      console.log(`[BLOCKED] Unauthorized publish attempt by ${client.id} on topic ${packet.topic}`);
      return callback(new Error("Not authorized to publish"));
    }
    
    if (topic === "reset-quiz" && (!packet.client || packet.client.id !== "server_authorized")) {
      return callback(new Error("Not authorized to publish to reset-quiz"));
    }

    if (topic.endsWith("score") && (!packet.client || packet.client.id !== "server_authorized")) {
      return callback(new Error("Not authorized to publish to reset-quiz"));
    }
  
    callback(null);
  };

  broker.authorizeSubscribe = (
    client: ExtendedAedesClient,
    subscription: { topic: string },
    callback: (error: Error | null, subscription?: { topic: string; qos: number }) => void
  ): void => {
    const topic = subscription.topic;
    
    if (topic.startsWith("quiz/response") && !client.authorized) {
      console.log(`[BLOCKED] Unauthorized subscribe attempt by ${client.id} on topic ${subscription.topic}`);
      return callback(new Error("Not authorized to subscribe to this topic"));
    }
    // Otherwise, allow the subscription with default qos.
    callback(null, { topic, qos: 1 });
  };


  const connectedClients = new Map<string, ClientData>();
  let activeSession: string | null = null; // Active quiz session
  let currentAnswerDistribution: { [key: string]: Set<string> } = { };
  const questionTimestamps = new Map<string, number>();
  const questionCloseTimeouts = new Map<string, NodeJS.Timeout>();



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
    // currentAnswerDistribution = { "1": 0, "2": 0, "3": 0, "4": 0 };
    currentAnswerDistribution = {};
    optionsResult.forEach((opt: any) => {
      currentAnswerDistribution[opt.id] = new Set();
    });
  
    const broadcastTimestamp = Date.now();
  
    // Record the broadcast timestamp for this question
    questionTimestamps.set(questionData.id, broadcastTimestamp);
    
    const correctOptionIds = optionsResult.filter((opt:any) => opt.isCorrect).map((opt:any) => opt.id);
    const payload = {
      id: questionData.id,
      text: questionData.text,
      type: questionData.type, // Include the question type (e.g., "multi_select" or "single_select")
      options: optionsResult.map(opt => ({ id: opt.id, text: opt.text })),
      correctOptionIds,
      timestamp: broadcastTimestamp,
    };


    console.log("Broadcasting question payload:", payload);
  
    // Publish the question details to topic "quiz/question"
    broker.publish({
      topic: "quiz/question",
      payload: Buffer.from(JSON.stringify(payload)),
      qos: 1,
    });
  
    // Close the question after 30 seconds
    const timeoutHandle = setTimeout(async () => {
      const closePayload = { questionId: questionData.id, closedAt: Date.now() };
      broker.publish({
        topic: "quiz/question/closed",
        payload: Buffer.from(JSON.stringify(closePayload)),
        qos: 1,
      });
      console.log(`[QUIZ] Closed question: ${questionData.id}`);

      const playersInSession = await db
      .select({ count: sql`count(*)` })
      .from(players)
      .where(eq(players.sessionId, sessionId));
      const expectedResponses = Number(playersInSession[0].count);

      const actualResponses = await db
      .select({ count: sql`count(*)` })
      .from(responses)
      .where(and(
        eq(responses.questionId, questionData.id),
        eq(responses.sessionId, sessionId)
      ));

      const receivedCount = Number(actualResponses[0].count);
      const deliveryRate = expectedResponses === 0 ? 0 : (receivedCount / expectedResponses) * 100;

      const deliveryLogLine = `${new Date().toISOString()},${questionData.id},${expectedResponses},${receivedCount},${deliveryRate.toFixed(1)}%\n`;

      fs.appendFile(deliveryLogPath, deliveryLogLine, (err) => {
        if (err) console.error("[LOGGING] Failed to write delivery rate log:", err);
        else console.log(`[LOGGING] Delivery rate for Q${questionData.id}: ${deliveryRate.toFixed(1)}%`);
      });
      questionCloseTimeouts.delete(questionData.id);
    }, 30000);

    questionCloseTimeouts.set(questionData.id, timeoutHandle);
  
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
  broker.on("client", async (client: ExtendedAedesClient) => {
    if (client.id === "frontend_dashboard") return;
    let clientIp = "unknown";
    if (client.conn) {
      const socket = client.conn as unknown as net.Socket;
      client.authorized = false;
      clientIp = socket.remoteAddress || "unknown";
    }
    const clientInfo = connectedClients.get(client.id);
    if (!clientInfo) return;
    
    // Query the student's record from the database using studentId.
    if (clientInfo) {
      try {
        const studentRes = await db
          .select()
          .from(students)
          .where(eq(students.id, clientInfo.studentId!))
          .limit(1);
        if (studentRes.length > 0) {
          // Update the in-memory client info with the student's full name.
          clientInfo.name = studentRes[0].fullName;
          clientInfo.ip = clientIp;
        }
      } catch (err) {
        console.error("Failed to fetch student name:", err);
      }
    }
    publishClientCount();
    broker.publish({
      topic: `system/client/${client.id}/info`,
      payload: Buffer.from(JSON.stringify({ id: client.id, ip: clientIp, authenticated: true, authorized: false, name: clientInfo.name })),
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
  broker.on("publish", async (packet: PublishPacket, client: ExtendedAedesClient | null) => {
    if (!client) {
      return;
    }
    if (!client) return;
    const topic = packet.topic;
    const payloadStr = packet.payload.toString();
    // Handle quiz session join
    if (topic === "quiz/session/join") {
      if (activeSession != null) {
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
                eq(players.studentId, clientInfo.studentId!),
                eq(players.sessionId, sessionIdFromPayload)
              )
            )
            .limit(1);
          if (existing.length === 0) {
            await db.insert(players).values({
              id: generateUUID(),
              sessionId: sessionIdFromPayload,
              studentId: clientInfo.studentId!,
              score: 0,
            });
          }
          clientInfo.authorized = true
          // Mark client as authorized for publishing responses.
          client.authorized = true;
          if (clientInfo.studentId) {
            try {
              const studentRes = await db
                .select()
                .from(students)
                .where(eq(students.id, clientInfo.studentId))
                .limit(1);
              if (studentRes.length > 0) {
                // Update the in-memory client info with the student's full name.
                clientInfo.name = studentRes[0].fullName;
              }
            } catch (err) {
              console.error("Failed to fetch student name:", err);
            }
          }        
          broker.publish({
            topic: `system/client/${client.id}/info`,
            payload: Buffer.from(JSON.stringify({ id: client.id, ip: clientInfo.ip, authenticated: clientInfo.authenticated, authorized: clientInfo.authorized, name: clientInfo.name })),
            qos: 1,
          });
        } catch (error) {
          console.error("Failed to insert player into DB:", error);
        }
      }
      return;
    }


    // Handle quiz responses.
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
      const { questionId, timestamp } = answerObj;
      console.log("Received response for question id: ", questionId);
      console.log("Received client timestamp: ", timestamp);
      
      const receivedAt = Date.now();
      const latency = receivedAt - Number(timestamp);
      
      const latencyLogEntry = `${new Date().toISOString()},${client.id},${questionId},${latency}\n`;
      fs.appendFile(latencyLogPath, latencyLogEntry, (err) => {
        if (err) console.error("[LOGGING] Failed to write latency log:", err);
      });

      // For single-select responses, process as before.
      async function processResponse(optionId: string) {
        console.log("Received option id: ", optionId);
        try {
          if (!client) return;
          if (!player) return;
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
          
          const maxAllowedTime = 30000; // 30 seconds
          const questionBroadcastTimestamp = questionTimestamps.get(questionId);
          let computedResponseTime = 0;
          if (questionBroadcastTimestamp) {
            computedResponseTime = Number(timestamp) - questionBroadcastTimestamp;
          } else {
            console.log("Computed response time: ERROR");
          }
          console.log("Computed response time: ", computedResponseTime);
  
          const timeFactor = 1 - (computedResponseTime / maxAllowedTime);
          const pointsAwarded = isCorrect ? Math.round(questionRecord.points * timeFactor) : 0;  

          // Single-select branch.
          const existingResponse = await db
            .select()
            .from(responses)
            .where(
              and(
                eq(responses.playerId, client.id),
                eq(responses.questionId, questionId),
                eq(responses.sessionId, activeSession as string)
              )
            )
            .limit(1);
          if (existingResponse.length > 0) {
            // Revert previous points
            const prevPoints = existingResponse[0].pointsAwarded || 0;
            const delta = pointsAwarded - prevPoints;
            player.score += delta;
            if (player.score < 0) {
              player.score = 0;
            }
            // Remove client's previous selection from its distribution set.
            const prevOptionId = existingResponse[0].optionId;
            if (currentAnswerDistribution[prevOptionId]) {
              currentAnswerDistribution[prevOptionId].delete(client.id);
            }
            await db
              .update(responses)
              .set({
                optionId: optionId,
                responseTime: computedResponseTime,
                isCorrect: isCorrect,
                pointsAwarded: pointsAwarded,
              })
              .where(eq(responses.id, existingResponse[0].id));
            console.log(`[QUIZ] Updated response for ${client.id}`);
          } else {
            await db.insert(responses).values({
              id: generateUUID(),
              sessionId: activeSession as string,
              questionId,
              playerId: client.id,
              optionId,
              responseTime: computedResponseTime,
              isCorrect,
              pointsAwarded,
            });
            if (isCorrect) {
              player.score += pointsAwarded;
            }
          }
          console.log(player.studentId)
          await db
            .update(players)
            .set({ score: player.score })
            .where(eq(players.studentId, player.studentId!));
          
          broker.publish({
            topic: `quiz/player/${client.id}/score`,
            payload: Buffer.from(JSON.stringify({ id: client.id, score: player.score })),
            qos: 1,
            client: { id: "server_authorized" }
          });
          
          // Update distribution for single-select.
          currentAnswerDistribution[optionRecord.id].add(client.id);
          
          const distributionToPublish: { [key: string]: number } = {};
          const unionSet = new Set<string>();
          for (const [optId, clientSet] of Object.entries(currentAnswerDistribution)) {
            distributionToPublish[optId] = clientSet.size;
            for (const cid of clientSet) {
              unionSet.add(cid);
            }
          }
          const uniqueRespondents = unionSet.size;
          broker.publish({
            topic: "quiz/answers/distribution",
            payload: Buffer.from(JSON.stringify({ distribution: distributionToPublish, uniqueRespondents })),
            qos: 1,
          });
          console.log(`[QUIZ] ${client.id} answered ${isCorrect ? "correctly" : "incorrectly"}. New score: ${player.score}`);
        } catch (dbErr) {
          console.error("DB Error processing quiz response:", dbErr);
        }
      }
      
      // Process multi-select submissions as one submission.
      if (answerObj.optionId) {
        // Single-select: process one optionId.
        processResponse(answerObj.optionId);
      } else if (answerObj.optionIds) {
        // Multi-select: process the answer as one submission.
        const submittedOptionIds: string[] = answerObj.optionIds;
        
        // Retrieve the question record.
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
        
        // Retrieve correct options from the DB.
        const correctOptionsResult = await db
          .select()
          .from(options)
          .where(and(eq(options.questionId, questionId), eq(options.isCorrect, true)));
        let correctOptionIds: string[] = correctOptionsResult.map((opt: any) => opt.id);
        
        // Sort both arrays to compare them.
        submittedOptionIds.sort();
        correctOptionIds.sort();
        let exactMatch = JSON.stringify(submittedOptionIds) === JSON.stringify(correctOptionIds);
        
        const maxAllowedTime = 30000;
        const questionBroadcastTimestamp = questionTimestamps.get(questionId);
        let computedResponseTime = 0;
        if (questionBroadcastTimestamp) {
          computedResponseTime = Number(timestamp) - questionBroadcastTimestamp;
        } else {
          console.log("Computed response time: ERROR");
        }
        const timeFactor = computedResponseTime < maxAllowedTime ? 1 - (computedResponseTime / maxAllowedTime) : 0;
        const allocatedPoints = questionRecord.points || 0;
        const pointsAwarded = exactMatch ? Math.round(allocatedPoints * timeFactor) : 0;
        
        // Retrieve any existing multi-select responses for this player and question.
        const existingResponses = await db
        .select()
        .from(responses)
        .where(
          and(
            eq(responses.playerId, client.id),
            eq(responses.questionId, questionId),
            eq(responses.sessionId, activeSession as string)
          )
        );
        let prevPoints = 0;
        for (const resp of existingResponses) {
          prevPoints += resp.pointsAwarded || 0;
        }
        const delta = pointsAwarded - prevPoints;
        player.score += delta;
        if (player.score < 0) player.score = 0;

        if (existingResponses.length > 0) {
          // Delete existing multi-select responses.
          await db.delete(responses)
            .where(
              and(
                eq(responses.playerId, client.id),
                eq(responses.questionId, questionId),
                eq(responses.sessionId, activeSession as string)
              )
            )
            .execute();
        }

        // Insert separate row for each selected option.
        for (const optId of submittedOptionIds) {
          await db.insert(responses).values({
            id: generateUUID(),
            sessionId: activeSession as string,
            questionId,
            playerId: client.id,
            optionId: optId,
            responseTime: computedResponseTime,
            isCorrect: exactMatch, // Mark as correct only if full match.
            pointsAwarded: exactMatch ? pointsAwarded : 0,
          });
        }
        await db.update(players).set({ score: player.score }).where(eq(players.studentId, player.studentId!));
        
        broker.publish({
          topic: `quiz/player/${client.id}/score`,
          payload: Buffer.from(JSON.stringify({ id: client.id, score: player.score })),
          qos: 1,
          client: { id: "server_authorized" }
        });

        for (const [optId, clientSet] of Object.entries(currentAnswerDistribution)) {
          clientSet.delete(client.id);
        }
        
        // Update distribution: for each submitted option, add client.id.
        for (const optId of submittedOptionIds) {
          if (currentAnswerDistribution[optId]) {
            currentAnswerDistribution[optId].add(client.id);
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
        broker.publish({
          topic: "quiz/answers/distribution",
          payload: Buffer.from(JSON.stringify({ distribution: distributionToPublish, uniqueRespondents })),
          qos: 1,
        });
        console.log(`[QUIZ] ${client.id} multi-select processed. Exact match: ${exactMatch}, Points: ${pointsAwarded}`);
      }
    }
  });


  // Add these API endpoints to your server code where the other endpoints are defined

// API Endpoint: Register Device - for M5StickC Plus registration
app.post("/api/register-device", async (c) => {
  try {
    const { macAddress, playerName, password } = await c.req.json();
    
    console.log("[REGISTER] Received registration request:", { macAddress, playerName });
    
    if (!macAddress) {
      console.log("[REGISTER] Missing MAC address");
      return c.json({ success: false, error: "MAC address is required" }, 400);
    }
    console.log("Attempting to connect to database...");
    // Check if device already exists
    const existingDevices = await db.select()
      .from(deviceCredentials)
      .where(eq(deviceCredentials.macAddress, macAddress))
      .limit(1)
      .catch(err => {
        console.error("Database SELECT error:", err);
        throw err;
      });
    
    const securePassword = password || `m5_${Math.random().toString(36).substring(2, 10)}`;
    
    if (existingDevices.length > 0) {
      // Update existing device
      await db
        .update(deviceCredentials)
        .set({
          password: securePassword,
          isActive: true
        })
        .where(eq(deviceCredentials.id, existingDevices[0].id));
      
      console.log(`[REGISTER] Updated device: ${macAddress}`);
      return c.json({
        success: true,
        message: "Device updated successfully",
        password: securePassword
      });
    } else {
      // Create new device
      const studentId = generateUUID();
      await db.insert(students).values({
        id: studentId,
        fullName: playerName || `Player-${macAddress.slice(-6)}`,
        createdAt: new Date(),
      });

      const deviceId = generateUUID();
      await db
        .insert(deviceCredentials)
        .values({
          id: deviceId,
          macAddress: macAddress,
          password: securePassword,
          studentId,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      
      console.log(`[REGISTER] New device registered: ${macAddress}`);
      return c.json({
        success: true,
        message: "Device registered successfully",
        password: securePassword
      });
    }
  } catch (error) {
    console.error("[REGISTER] Error:", error);
    return c.json({ 
      success: false, 
      error: "Failed to register device" 
    }, 500);
  }
});

// API Endpoint: Test endpoint for basic connectivity testing
app.get("/api/test", (c) => {
  return c.json({ status: "ok", message: "Server is running" });
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

    deliveryTracker.sessionId = sessionId;
    deliveryTracker.receivedCount = 0;


    const playersInSession = await db.select().from(players).where(eq(players.sessionId, sessionId));

    deliveryTracker.totalExpected = playersInSession.length;

    console.log(`[DELIVERY] Expecting ${deliveryTracker.totalExpected} responses.`);

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
      .select({
        id: players.id,
        sessionId: players.sessionId,
        studentId: players.studentId,
        score: players.score,
        joinedAt: players.joinedAt,
        lastActive: players.lastActive,
        name: students.fullName, // include student's full name
      })
      .from(players)
      .innerJoin(students, eq(students.id, players.studentId))
      .where(eq(players.sessionId, sessionId))
      .orderBy(desc(players.score));
  
    return c.json(leaderboard);
  });

  // API Endpoint: Manually close the current question
app.post("/api/quiz/close-question", async (c) => {
    const { sessionId, questionId } = await c.req.json();
    if (!sessionId || !questionId) {
      return c.text("Session ID and Question ID required", 400);
    }
    
    // If a timeout is pending for this question, cancel it.
    const timeoutHandle = questionCloseTimeouts.get(questionId);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      questionCloseTimeouts.delete(questionId);
    }
    
    // Publish the question closed message immediately.
    const closePayload = { questionId, closedAt: Date.now() };
    broker.publish({
      topic: "quiz/question/closed",
      payload: Buffer.from(JSON.stringify(closePayload)),
      qos: 1,
    });
    console.log(`[QUIZ] Manually closed question: ${questionId}`);

    const playersInSession = await db
      .select({ count: sql`count(*)` })
      .from(players)
      .where(eq(players.sessionId, sessionId));
    const expectedResponses = Number(playersInSession[0].count);

    const actualResponses = await db
      .select({ count: sql`count(*)` })
      .from(responses)
      .where(and(
        eq(responses.questionId, questionId),
        eq(responses.sessionId, sessionId)
      ));  
    const receivedCount = Number(actualResponses[0].count);
    const deliveryRate = expectedResponses === 0 ? 0 : (receivedCount / expectedResponses) * 100;
    const deliveryLogLine = `${new Date().toISOString()},${questionId},${expectedResponses},${receivedCount},${deliveryRate.toFixed(1)}%\n`;
    fs.appendFile(deliveryLogPath, deliveryLogLine, (err) => {
      if (err) console.error("[LOGGING] Failed to write delivery rate log:", err);
      else console.log(`[LOGGING] Delivery rate for Q${questionId}: ${deliveryRate.toFixed(1)}%`);
    });

    return c.json({ message: "Question closed manually", questionId });
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
    activeSession = null;
    return c.json({ message: "Quiz ended", sessionId })
  });

  // API Endpoint: Reset Scores – resets the score for all players in a session to 0.
  app.post("/api/quiz/reset-quiz", async (c) => {
    const { sessionId } = await c.req.json();
    if (!sessionId) return c.text("Session ID required", 400);

     // Update all players belonging to this session to have a score of 0.
    await db.update(players)
    .set({ score: 0 })
    .where(eq(players.sessionId, sessionId));

    const sessionPlayers = await db.select().from(players).where(eq(players.sessionId, sessionId));
    sessionPlayers.forEach((p) => {
      broker.publish({
        topic: `quiz/player/${p.id}/score`,
        payload: Buffer.from(JSON.stringify({ id: p.id, score: 0 })),
        qos: 1,
        client: { id: "server_authorized" }
      });
    });


    broker.publish({
      topic: "quiz/reset-quiz",
      payload: Buffer.from(JSON.stringify({ sessionId, message: "Quiz is reset" })),
      qos: 1,
      client: { id: "server_authorized" }
    }, (err: Error | null) => {
      if (err) {
        console.error("Failed to publish reset-quiz:", err);
      } else {
        console.log("Published reset-quiz message successfully.");
      }
    });
    
    return c.json({ message: `Restart Quiz ${sessionId} with same questions` });
  });

  
  const mqttPort = 8443; // Standard secure Websocket port
  const webserverPort = 3001;
  const tlsPort = 8883; // Standard secure MQTT port

  const tlsOptions = {
    key: fs.readFileSync("./certificates/server.key"),
    cert: fs.readFileSync("./certificates/server.crt"),
    ca: fs.readFileSync("./certificates/rootCA.pem"),
  };

  const httpsOptions = {
    key: fs.readFileSync("./certificates/https-key.pem"),
    cert: fs.readFileSync("./certificates/https.pem"),
    ca: fs.readFileSync("./certificates/rootCA.pem"),
  } 

  function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
      // Check if the interface name indicates it's a wireless interface
      if (name.toLowerCase().includes("wlan") || name.toLowerCase().includes("wi-fi")) {
        for (const iface of interfaces[name]!) {
          if (iface.family === "IPv4" && !iface.internal) {
            return iface.address;
          }
        }
      }
    }
    // If no wireless interface found, default to localhost
    return "127.0.0.1";
  }

  // Start secure MQTT WebSocket server
  const httpsServer = createServer(broker, { ws: true, https: httpsOptions });
  httpsServer.listen(mqttPort, () => {
    console.log("WebSocket MQTT server running on port:", mqttPort);
  });


  // Start secure MQTT TCP server using TLS
  const tlsServer = tls.createServer(tlsOptions, broker.handle);
  tlsServer.listen(tlsPort,() => {
    console.log("[TLS] Secure MQTT server listening on", getLocalIpAddress() + ":" + tlsPort);
  });
  tlsServer.on("connection", (socket) => {
    console.log("[TLS] New secure client connection from:", socket.remoteAddress);
  });
  tlsServer.on("close", () => {
    console.log("[TCP] Server closed");
  });
  tlsServer.on("error", (err) => {
    console.error("[TLS] Error:", err);
  });
 

  // HTTP Routes
  app.get("/", (c) => {
    return c.text("Webserver & MQTT Server are running");
  });

  // Start secure web server for API Calls
  serve({ fetch: app.fetch, createServer: createHttpsServer, 
    serverOptions: httpsOptions, port: webserverPort });

  console.log(`Worker ${process.pid} started and is handling MQTT and HTTP traffic.`);
}