import mqtt from "mqtt";
import { useEffect, useRef, useState } from "react";
import { ClientInfo, DistributionPayload } from "@/types/mqtt";

// Unique client identifier for the frontend dashboard
const FRONTEND_CLIENT_ID = "frontend_dashboard";

/**
 * Custom hook to handle MQTT connections and messaging.
 */
export function useMqtt() {
  // Local state for storing MQTT client data and connection status
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [totalClients, setTotalClients] = useState(0);
  const [sessionStatus, setSessionStatus] = useState("pending");
  const [answerDistribution, setAnswerDistribution] = useState<DistributionPayload | null>(null);
  const [broadcastQuestion, setBroadcastQuestion] = useState<any>(null);

  // Persist MQTT connection across renders
  const mqttClientRef = useRef<mqtt.MqttClient | null>(null);

  // Initialize MQTT connection once when the component mounts
  useEffect(() => {
    if (!mqttClientRef.current) {
      // Connect to the MQTT broker over secure WebSocket
      mqttClientRef.current = mqtt.connect("wss://localhost:8443", {
        clientId: FRONTEND_CLIENT_ID,
        clean: false,
        reconnectPeriod: 5000,
        keepalive: 60,
      });

      // When connection is established, update state and subscribe to topics
      mqttClientRef.current.on("connect", () => {
        console.log(`Connected to MQTT broker as ${FRONTEND_CLIENT_ID}`);
        setIsConnected(true);

        // Subscribe to necessary topics with QoS 1
        mqttClientRef.current?.subscribe(
          [
            "system/client_count",
            "system/client/+/info",
            "system/client/+/disconnect",
            "quiz/session/start",
            "quiz/player/+/score",
            "quiz/answers/distribution",
            "quiz/question",
          ],
          {qos: 1},
          (err) => {
            if (err) {
              console.error("Subscription error:", err);
            }
          }
        );
        console.log("Sucess");
      });

      // Handle incoming messages
      mqttClientRef.current.on("message", (topic, message) => {
        try {
          const messageStr = message.toString();
          let payload: any;
          if (messageStr.trim().startsWith("{")) {
            payload = JSON.parse(messageStr);
          } else {
            payload = messageStr;
          }

          // Handle answer distribution messages
          if (topic === "quiz/answers/distribution") {
            setAnswerDistribution(payload as DistributionPayload);
            return;
          }

          // Handle session start status messages
          if (topic === "quiz/session/start") {
            setSessionStatus(messageStr);
            console.log(`[QUIZ] New session started: ${messageStr}`);
            return;
          }

          // Handle broadcast question messages.
          if (topic === "quiz/question") {
            setAnswerDistribution({ distribution: {}, uniqueRespondents: 0 });
            setBroadcastQuestion(payload);
            return;
          }

          // Handle client count updates
          if (topic === "system/client_count") {
            setTotalClients(parseInt(messageStr, 10));
          }

          // Handle client disconnection
          if (topic.startsWith("system/client/") && topic.endsWith("/disconnect")) {
            const clientId = messageStr;
            setClients((prev) => prev.filter((c) => c.id !== clientId));
          }

          // Handle client info updates
          if (topic.startsWith("system/client/") && topic.endsWith("/info")) {
            console.log(payload)
            setClients((prev) => {
              const existing = prev.find((c) => c.id === payload.id);
              if (existing) {
                return prev.map((c) =>
                  c.id === payload.id ? { ...c, ip: payload.ip, authenticated: payload.authenticated, authorized: payload.authorized, name: payload.name } : c
                );
              }
              return [...prev, payload];
            });
          }

          // Handle player score updates
          if (topic.startsWith("quiz/player/") && topic.endsWith("/score")) {
            console.log("Score update received:", payload);
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

  return {
    clients: clients.filter((c) => c.id !== FRONTEND_CLIENT_ID),
    isConnected,
    totalClients,
    answerDistribution,
    broadcastQuestion,
    setAnswerDistribution,
    setBroadcastQuestion,
    setClients,
    setTotalClients,
    setSessionStatus,
  };
}
