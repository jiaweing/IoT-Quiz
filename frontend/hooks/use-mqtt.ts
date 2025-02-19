import mqtt from "mqtt";
import { useEffect, useState } from "react";

interface AccelerometerData {
  x: number;
  y: number;
  z: number;
}

interface ClientInfo {
  id: string;
  ip: string;
  data?: AccelerometerData;
}

export function useMqtt() {
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [totalClients, setTotalClients] = useState(0);

  useEffect(() => {
    // Connect using WebSocket
    const mqttClient = mqtt.connect("ws://localhost:8888");

    mqttClient.on("connect", () => {
      console.log("Connected to MQTT broker");
      setIsConnected(true);

      // Subscribe to all needed topics
      mqttClient.subscribe(
        [
          "sensor/+/data", // Client-specific data topic
          "system/client_count", // Total clients count topic
          "system/client/+/info", // Client info topic
          "system/client/+/disconnect", // Client disconnect topic
        ],
        (err) => {
          if (err) {
            console.error("Subscription error:", err);
          }
        }
      );
    });

    mqttClient.on("message", (topic, message) => {
      try {
        // Handle client-specific data
        if (topic.startsWith("sensor/") && topic.endsWith("/data")) {
          const clientId = topic.split("/")[1];
          const payload = JSON.parse(message.toString());

          setClients((prev) => {
            const existing = prev.find((c) => c.id === clientId);
            if (existing) {
              return prev.map((c) =>
                c.id === clientId ? { ...c, data: payload } : c
              );
            }
            return [...prev, { id: clientId, ip: "loading...", data: payload }];
          });
        }
        // Handle total clients count
        else if (topic === "system/client_count") {
          setTotalClients(parseInt(message.toString(), 10));
        }
        // Handle client disconnection
        else if (
          topic.startsWith("system/client/") &&
          topic.endsWith("/disconnect")
        ) {
          const clientId = message.toString();
          setClients((prev) => prev.filter((c) => c.id !== clientId));
        }
        // Handle client info updates
        else if (
          topic.startsWith("system/client/") &&
          topic.endsWith("/info")
        ) {
          const payload = JSON.parse(message.toString());
          setClients((prev) => {
            const existing = prev.find((c) => c.id === payload.id);
            if (existing) {
              return prev.map((c) =>
                c.id === payload.id ? { ...c, ip: payload.ip } : c
              );
            }
            return [...prev, payload];
          });
        }
      } catch (e) {
        console.error("Failed to parse message:", e);
      }
    });

    // Fetch initial clients list
    fetch("http://localhost:3001/api/clients")
      .then((res) => res.json())
      .then((data) => {
        setClients(data);
        setTotalClients(data.length);
      })
      .catch((err) => {
        console.error("Failed to fetch clients:", err);
      });

    mqttClient.on("error", (err) => {
      console.error("MQTT error:", err);
      setIsConnected(false);
    });

    mqttClient.on("close", () => {
      console.log("MQTT connection closed");
      setIsConnected(false);
    });

    return () => {
      mqttClient.end();
    };
  }, []);

  return { clients, isConnected, totalClients };
}
