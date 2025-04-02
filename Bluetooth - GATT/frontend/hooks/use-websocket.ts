import { useEffect, useRef, useState } from "react";
import { ClientInfo, DistributionPayload } from "@/types/websocket";

export function useWebsocket() {
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [totalClients, setTotalClients] = useState(0);
  const [sessionStatus, setSessionStatus] = useState("pending");
  const [answerDistribution, setAnswerDistribution] = useState<DistributionPayload | null>(null);
  const [broadcastQuestion, setBroadcastQuestion] = useState<any>(null);

  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket("wss://localhost:8443");
    socketRef.current = ws;

    ws.onerror = (error) => {
      console.error("WebSocket error:", error, "Ready state:", ws.readyState);
    };

    ws.onopen = () => {
      console.log("WebSocket connected");
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        console.log("Client Count:", event.data);
        const data = JSON.parse(event.data);
       
        // Expecting messages with a "type" and a "payload" property.
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
            console.log("Client Count:", data.payload);
            setTotalClients(parseInt(data.payload, 10));
            break;
          case "clientInfo":
            
            // If the client is connected, add/update; if not, remove it.
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
      console.log("WebSocket disconnected");
      setIsConnected(false);
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    return () => {
      ws.close();
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
