import mqtt from "mqtt";
import { useEffect, useRef, useState } from "react";

export interface ClientInfo {
  id: string;
  ip: string;
  session?: string;
  score?: number;
}

// Give the frontend a unique identifier
const FRONTEND_CLIENT_ID = "frontend_dashboard";

export function useMqtt() {
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [totalClients, setTotalClients] = useState(0);
  // New state for answer distribution (for 4 answers)
  const [answerDistribution, setAnswerDistribution] = useState<{ [key: string]: number }>({
  "1": 0,
  "2": 0,
  "3": 0,
  "4": 0,
});

  // Persist MQTT connection across renders
  const mqttClientRef = useRef<mqtt.MqttClient | null>(null);

  useEffect(() => {
    if (!mqttClientRef.current) {
      mqttClientRef.current = mqtt.connect("ws://localhost:8888", {
        clientId: FRONTEND_CLIENT_ID,
        clean: false,
        reconnectPeriod: 5000,
        keepalive: 60,
      });

      mqttClientRef.current.on("connect", () => {
        console.log(`Connected to MQTT broker as ${FRONTEND_CLIENT_ID}`);
        setIsConnected(true);

        mqttClientRef.current?.subscribe(
          [
            "system/client_count",
            "system/client/+/info",
            "system/client/+/disconnect",
            "quiz/session/start",
            "quiz/player/+/score",
            "quiz/answers/distribution",
          ],
          (err) => {
            if (err) {
              console.error("Subscription error:", err);
            }
          }
        );
      });

      mqttClientRef.current.on("message", (topic, message) => {
        try {
          const messageStr = message.toString();

          // Special handling for answer distribution
          if (topic === "quiz/answers/distribution") {
            const distributionObj = JSON.parse(messageStr);
            setAnswerDistribution(distributionObj);
            return;
          }

          // For topics known to send plain text (e.g., quiz/session/start), do not parse
          if (topic === "quiz/session/start") {
            console.log(`[QUIZ] New session started: ${messageStr}`);
            return;
          }

          // For other topics, only parse if it looks like JSON
          let payload: any;
          if (messageStr.trim().startsWith("{")) {
            payload = JSON.parse(messageStr);
          } else {
            payload = messageStr;
          }

          // Handle sensor data if needed
          if (topic.startsWith("sensor/") && topic.endsWith("/data")) {
            const clientId = topic.split("/")[1];
            setClients((prev) =>
              prev.map((c) =>
                c.id === clientId ? { ...c, data: payload } : c
              )
            );
          }

          // Handle client count updates
          else if (topic === "system/client_count") {
            setTotalClients(parseInt(messageStr, 10));
          }

          // Handle client disconnection
          else if (topic.startsWith("system/client/") && topic.endsWith("/disconnect")) {
            const clientId = messageStr;
            setClients((prev) => prev.filter((c) => c.id !== clientId));
          }

          // Handle client info updates
          else if (topic.startsWith("system/client/") && topic.endsWith("/info")) {
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

          // Handle player score updates
          else if (topic.startsWith("quiz/player/") && topic.endsWith("/score")) {
            setClients((prev) =>
              prev.map((c) =>
                c.id === payload.id ? { ...c, score: payload.score } : c
              )
            );
          }
        } catch (e) {
          console.error("Failed to parse message:", e);
        }
      });

      mqttClientRef.current.on("close", () => {
        console.warn("MQTT connection closed");
        setIsConnected(false);
      });

      mqttClientRef.current.on("error", (error) => {
        console.error("MQTT Error:", error);
      });
    }

    return () => {
      console.log("Frontend disconnecting from MQTT...");
      mqttClientRef.current?.end();
      mqttClientRef.current = null;
    };
  }, []);

  const publish = (topic: string, message: string) => {
    if (isConnected) {
      mqttClientRef.current?.publish(topic, message);
    } else {
      console.error("MQTT is not connected. Cannot publish message.");
    }
  };

  return {
    clients: clients.filter((c) => c.id !== FRONTEND_CLIENT_ID),
    isConnected,
    totalClients,
    publish,
    answerDistribution,
  };
}
