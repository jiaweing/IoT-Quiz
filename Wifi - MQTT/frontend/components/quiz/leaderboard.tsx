import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LeaderboardEntry } from "@/types/quiz";
import { Plus, RefreshCw, Trophy } from "lucide-react";

interface LeaderboardProps {
  leaderboard: LeaderboardEntry[];
  onRestartSame: () => void;
  onRestartNew: () => void;
}

const TROPHY_COLORS = {
  0: "text-yellow-500",
  1: "text-gray-400",
  2: "text-amber-600",
};

export function Leaderboard({
  leaderboard,
  onRestartSame,
  onRestartNew,
}: LeaderboardProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight text-white">Quiz Completed!</h2>
        <p className="text-lg text-muted-foreground text-white">Final Results</p>
      </div>

      <div className="flex gap-4">
        <Button onClick={onRestartSame} className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4" />
          Restart with Same Questions
        </Button>
        <Button
          onClick={onRestartNew}
          variant="outline"
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          New Quiz
        </Button>
      </div>

      {leaderboard.length > 0 ? (
        <div className="grid gap-4">
          {leaderboard.map((player, index) => (
            <Card key={player.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {index < 3 && (
                      <div
                        className={
                          TROPHY_COLORS[index as keyof typeof TROPHY_COLORS]
                        }
                      >
                        <Trophy className="h-6 w-6" />
                      </div>
                    )}
                    <div>
                      <p className="font-semibold">
                        {index + 1}. {player.name}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-base">
                    {player.score} points
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">No scores available</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
