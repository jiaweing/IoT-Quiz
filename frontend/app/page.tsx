"use client";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMqtt } from "@/hooks/use-mqtt";

export default function Home() {
  const { data, isConnected } = useMqtt();

  return (
    <main className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">M5 Stick Accelerometer Data</h1>

      <div className="mb-4">
        <div
          className={`inline-block w-3 h-3 rounded-full mr-2 ${
            isConnected ? "bg-green-500" : "bg-red-500"
          }`}
        />
        <span>{isConnected ? "Connected to MQTT" : "Disconnected"}</span>
      </div>

      <Card className="p-6">
        {data ? (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <h3 className="font-semibold mb-2">X-Axis</h3>
              <p className="text-2xl">{data.x.toFixed(2)}</p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Y-Axis</h3>
              <p className="text-2xl">{data.y.toFixed(2)}</p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Z-Axis</h3>
              <p className="text-2xl">{data.z.toFixed(2)}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i}>
                <Skeleton className="h-6 w-20 mb-2" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}
