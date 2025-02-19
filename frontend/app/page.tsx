"use client";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMqtt } from "@/hooks/use-mqtt";

export default function Home() {
  const { clients, isConnected, totalClients } = useMqtt();

  return (
    <main className="container mx-auto py-10 p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">M5 Stick Accelerometer Data</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center">
            <span className="relative flex size-3 mr-2">
              {isConnected && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
              )}
              <span
                className={`relative inline-flex size-3 rounded-full ${
                  isConnected ? "bg-green-500" : "bg-red-500"
                }`}
              ></span>
            </span>
            <span>{isConnected ? "Connected" : "Disconnected"}</span>
          </div>
          <div className="text-sm font-medium">
            Connected Clients: {totalClients}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {clients.map((client) => (
          <Card
            key={client.id}
            className="p-6 transition-all duration-300 hover:shadow-lg hover:scale-[1.02] bg-white/50 backdrop-blur-sm dark:bg-slate-900/50"
          >
            <div className="mb-4">
              <h2 className="font-semibold text-lg mb-1">
                Client: {client.id}
              </h2>
              <p className="text-sm text-gray-500">
                IP: {client.ip.replace("::ffff:", "")}
              </p>
            </div>

            {client.data ? (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <h3 className="font-semibold mb-2">X-Axis</h3>
                  <p className="text-2xl">{client.data.x.toFixed(2)}</p>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Y-Axis</h3>
                  <p className="text-2xl">{client.data.y.toFixed(2)}</p>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Z-Axis</h3>
                  <p className="text-2xl">{client.data.z.toFixed(2)}</p>
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
        ))}

        {clients.length === 0 && (
          <Card className="p-6 col-span-full">
            <p className="text-center text-gray-500">No connected clients</p>
          </Card>
        )}
      </div>
    </main>
  );
}
