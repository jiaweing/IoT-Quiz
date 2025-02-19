import mqtt from "mqtt";
import { useEffect, useState } from "react";

type AccelerometerData = {
  x: number;
  y: number;
  z: number;
};

export function useMqtt() {
  const [client, setClient] = useState<mqtt.MqttClient | null>(null);
  const [data, setData] = useState<AccelerometerData | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Connect using WebSocket
    const mqttClient = mqtt.connect("ws://localhost:8888");

    mqttClient.on("connect", () => {
      console.log("Connected to MQTT broker");
      setIsConnected(true);

      // Subscribe to the accelerometer topic
      mqttClient.subscribe("sensor/accelerometer", (err) => {
        if (err) {
          console.error("Subscription error:", err);
        }
      });
    });

    mqttClient.on("message", (topic, message) => {
      if (topic === "sensor/accelerometer") {
        try {
          const payload = JSON.parse(message.toString());
          setData(payload);
        } catch (e) {
          console.error("Failed to parse message:", e);
        }
      }
    });

    mqttClient.on("error", (err) => {
      console.error("MQTT error:", err);
      setIsConnected(false);
    });

    mqttClient.on("close", () => {
      console.log("MQTT connection closed");
      setIsConnected(false);
    });

    setClient(mqttClient);

    return () => {
      mqttClient.end();
    };
  }, []);

  return { data, isConnected };
}
