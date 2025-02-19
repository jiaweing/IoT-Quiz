import { serve } from "@hono/node-server";
import type { Client } from "aedes";
import { createServer } from "aedes-server-factory";
import { Hono } from "hono";
import net from "net";
import os from "os";
import { require } from "./cjs-loader.js";

interface PublishPacket {
  topic: string;
  payload: Buffer;
  client?: {
    id: string;
  };
}

interface ClientData {
  id: string;
  ip: string;
  lastData?: {
    x: number;
    y: number;
    z: number;
  };
}

const app = new Hono().use("*", async (c, next) => {
  // Add CORS headers
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight requests
  if (c.req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  await next();
});
const broker = require("aedes")();
const connectedClients = new Map<string, ClientData>();

// Republish client count when websocket client connects
broker.on("clientReady", (client: Client) => {
  publishClientCount();
});

// Track client connections
broker.on("client", (client: Client) => {
  // Get client IP from socket
  let clientIp = "unknown";
  if (client.conn) {
    const socket = client.conn as unknown as net.Socket;
    clientIp = socket.remoteAddress || "unknown";
  }

  const clientInfo = { id: client.id, ip: clientIp };
  connectedClients.set(client.id, clientInfo);
  publishClientCount();
  // Publish client info on connect
  broker.publish({
    topic: `system/client/${client.id}/info`,
    payload: Buffer.from(JSON.stringify(clientInfo)),
    qos: 0,
  });
  console.log(`[WS] Client connected: ${client.id} from ${clientIp}`);
});

broker.on("clientDisconnect", (client: Client) => {
  connectedClients.delete(client.id);
  publishClientCount();
  // Publish disconnect event
  broker.publish({
    topic: `system/client/${client.id}/disconnect`,
    payload: Buffer.from(client.id),
    qos: 0,
  });
  console.log(`[WS] Client disconnected: ${client.id}`);
});

function publishClientCount() {
  // Add a small delay before publishing to ensure client is fully connected
  setTimeout(() => {
    // -1 for webserver
    const count = connectedClients.size - 1;
    broker.publish({
      topic: "system/client_count",
      payload: Buffer.from(count.toString()),
      qos: 0,
    });
  }, 500); // 500ms delay
}

// Handle all incoming messages and logging
broker.on("publish", (packet: PublishPacket, client: Client | null) => {
  // Log all published messages for debugging
  if (client) {
    console.log("--------------------");
    console.log(`Client ID: ${client.id}`);
    console.log(`Topic: ${packet.topic}`);
    console.log(`Payload: ${packet.payload.toString()}`);
    console.log("--------------------");
  }

  // Handle accelerometer data
  if (client && packet.topic === "sensor/accelerometer") {
    try {
      const data = JSON.parse(packet.payload.toString());
      const clientId = client.id;

      // Update client data
      const clientInfo = connectedClients.get(clientId);
      if (clientInfo) {
        clientInfo.lastData = data;
        connectedClients.set(clientId, clientInfo);
      }

      // Forward data to client-specific topic for WebSocket clients
      broker.publish({
        topic: `sensor/${clientId}/data`,
        payload: packet.payload,
        qos: 0,
      });
    } catch (error) {
      console.error("Error parsing sensor data:", error);
    }
  }
});

// Add HTTP endpoint for client info
app.get("/api/clients", (c) => {
  return c.json(Array.from(connectedClients.values()));
});

const mqttPort = 8888;
const mqttTcpPort = 1883;
const webserverPort = 3001;

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      // Skip over non-IPv4 and internal (loopback) addresses
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1"; // Fallback to localhost if no other IP found
}

// websocket mqtt server
const httpServer = createServer(broker, {
  ws: true,
});

httpServer.listen(mqttPort, function () {
  const localIp = getLocalIpAddress();
  console.log("WebSocket MQTT port:", mqttPort);
});

// tcp mqtt server
const tcpServer = net.createServer(broker.handle);
tcpServer.listen(mqttTcpPort, function () {
  const localIp = getLocalIpAddress();
  console.log("[TCP] MQTT server listening on", localIp + ":" + mqttTcpPort);
});

tcpServer.on("connection", (socket) => {
  console.log("[TCP] New client connection from:", socket.remoteAddress);
  console.log("[TCP] Total clients:", broker.connectedClients);
});

tcpServer.on("close", () => {
  console.log("[TCP] Server closed");
});

tcpServer.on("error", (err) => {
  console.error("[TCP] Error:", err);
});

// HTTP routes
app.get("/", (c) => {
  return c.text("Webserver & MQTT Server are running");
});

serve({ fetch: app.fetch, port: webserverPort });
