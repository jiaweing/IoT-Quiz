import { useEffect, useRef, useState } from "react";
import { ClientInfo, DistributionPayload } from "@/types/websocket";

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 1000; // Initial retry delay = 1s

export function useWebsocket() {
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [totalClients, setTotalClients] = useState(0);
  const [sessionStatus, setSessionStatus] = useState("pending");
  const [answerDistribution, setAnswerDistribution] = useState<DistributionPayload | null>(null);
  const [broadcastQuestion, setBroadcastQuestion] = useState<any>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);

  const connect = () => {
    const ws = new WebSocket("wss://localhost:8443");
    socketRef.current = ws;

    ws.onopen = () => {
      console.log("✅ WebSocket connected");
      setIsConnected(true);
      reconnectAttempts.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case "question":
            setAnswerDistribution({ distribution: {}, uniqueRespondents: 0 });
            setBroadcastQuestion(data.payload);
            break;
          case "score":
            setClients((prev) =>
              prev.map((c) =>
                c.id === data.payload.id ? { ...c, score: data.payload.score } : c
              )
            );
            break;
          case "distribution":
            setAnswerDistribution(data.payload);
            break;
          case "sessionStatus":
            setSessionStatus(data.payload.status);
            break;
          case "clientCount":
            setTotalClients(parseInt(data.payload, 10));
            break;
          case "clientInfo":
            if (data.payload.connected === true) {
              setClients((prev) => {
                const exists = prev.find((c) => c.id === data.payload.id);
                if (exists) {
                  return prev.map((c) =>
                    c.id === data.payload.id ? { ...c, authenticated: data.payload.authenticated } : c
                  );
                }
                return [...prev, data.payload];
              });
            } else {
              setClients((prev) => prev.filter((c) => c.id !== data.payload.id));
            }
            break;
          default:
            console.log("Unhandled WebSocket message type:", data.type);
        }
      } catch (err) {
        console.error("Error parsing WebSocket message:", err);
      }
    };

    ws.onclose = () => {
      console.warn("❌ WebSocket disconnected");
      setIsConnected(false);
      attemptReconnect();
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      ws.close(); // Close and trigger onclose handler
    };
  };

  const attemptReconnect = () => {
    if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
      console.error("🔌 Max WebSocket reconnection attempts reached.");
      return;
    }

    const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts.current); // exponential backoff
    reconnectAttempts.current += 1;

    console.log(`🔁 Attempting to reconnect WebSocket in ${delay / 1000}s...`);

    reconnectTimeout.current = setTimeout(() => {
      connect();
    }, delay);
  };

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.close();
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    };
  }, []);

  return {
    clients,
    isConnected,
    totalClients,
    answerDistribution,
    setAnswerDistribution,
    setClients,
    setTotalClients,
    setSessionStatus,
    setBroadcastQuestion,
    broadcastQuestion,
    sessionStatus,
  };
}
