import { serve } from "@hono/node-server";
import type { AedesPublishPacket, Client } from "aedes";
import { createServer } from "aedes-server-factory";
import { Hono } from "hono";
import net from "net";
import os from "os";
import { require } from "./cjs-loader.js";

const app = new Hono();
const aedes = require("aedes")();

// Add MQTT subscription
aedes.subscribe(
  "sensor/accelerometer",
  function (packet: AedesPublishPacket, cb: () => void) {
    console.log("Published:", packet.payload.toString());

    // Send acknowledgment back to the device
    if (packet.topic === "sensor/accelerometer") {
      aedes.publish({
        topic: "sensor/status",
        payload: Buffer.from("Data received"),
        qos: 0,
      });
    }
    if (cb) cb();
  }
);

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
const httpServer = createServer(aedes, {
  ws: true,
});

httpServer.listen(mqttPort, function () {
  const localIp = getLocalIpAddress();
  console.log("WebSocket MQTT port:", mqttPort);
});

httpServer.on("client", (client: Client) => {
  console.log(`Client connected: ${client.id}`);
});

httpServer.on("clientDisconnect", (client: Client) => {
  console.log(`Client disconnected: ${client.id}`);
});

httpServer.on(
  "publish",
  (packet: AedesPublishPacket, client: Client | null) => {
    if (client) {
      console.log("--------------------");
      console.log(`Client ID: ${client.id}`);
      console.log(`Topic: ${packet.topic}`);
      console.log(`Payload: ${packet.payload.toString()}`);
      console.log(
        `Raw packet: ${JSON.stringify(
          { ...packet, payload: packet.payload.toString() },
          null,
          2
        )}`
      );
      console.log("--------------------");
    }
  }
);

// tcp mqtt server
const tcpServer = net.createServer(aedes.handle);
tcpServer.listen(mqttTcpPort, function () {
  const localIp = getLocalIpAddress();
  console.log("[TCP] MQTT server listening on", localIp + ":" + mqttTcpPort);
});

tcpServer.on("connection", (socket) => {
  console.log("[TCP] New client connection from:", socket.remoteAddress);
  console.log("[TCP] Total clients:", aedes.connectedClients);
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
