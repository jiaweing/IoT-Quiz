import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Client } from "@/types/quiz";

interface ConnectedPlayersProps {
  expectedTapSequence: string;
  clients: Client[];
  isConnected: boolean;
  totalClients: number;
  quizTitle: string;
  startSession: () => void;
  allowJoining:() => void;
}

export function ConnectedPlayers({
  expectedTapSequence,
  clients,
  isConnected,
  totalClients,
  quizTitle,
  startSession,
  allowJoining,
}: ConnectedPlayersProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl text-white font-bold tracking-tight">Waiting Room</h1>
          <p className="text-lg text-white text-muted-foreground">Quiz: {quizTitle} </p>
          <p className="text-lg text-white text-muted-foreground">Authorization Sequence: <span className="text-white underline font-bold">{expectedTapSequence}</span></p>
        </div>
        <div className="flex gap-2">
          <Button size="lg" onClick={startSession}>
            Start Quiz
          </Button>
          <Button size="lg"  onClick={allowJoining} variant="outline">
            Allow Joining
          </Button>
        </div>   
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Connection Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <span className="relative inline-flex h-3 w-3">
              {isConnected && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex h-3 w-3 rounded-full ${
                  isConnected ? "bg-green-500" : "bg-red-500"
                }`}
              />
            </span>
            <Badge variant={isConnected ? "default" : "destructive"}>
              {isConnected ? "Connected" : "Disconnected"}
            </Badge>
            <Badge variant="secondary">Total Players: {totalClients}</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {clients.length > 0 ? (
          clients.map((client) => (
            <Card key={client.id}>
              <CardContent className="p-4">
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-start">
                    <h3 className="font-semibold">Player {client.id}</h3>
                    <Badge variant="outline">{client.score} pts</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="col-span-full">
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground">
                Waiting for players to join...
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
