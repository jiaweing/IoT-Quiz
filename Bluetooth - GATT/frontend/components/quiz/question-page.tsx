import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useEffect, useState } from "react";

interface QuestionPageProps {
  question: {
    questionText: string;
    answers: string[];
    // correctAnswerIndex: number;
    correctAnswerIndex: number | number[]; 
    type?: "single_select" | "multi_select";
    timestamp: number;
  };
  currentIndex: number;
  totalQuestions: number;
  onNextQuestion: () => void;
  totalResponses: number;
}

export function QuestionPage({
  question,
  currentIndex,
  totalQuestions,
  onNextQuestion,
  totalResponses,
}: QuestionPageProps) {
  const maxTime = 30000; // 30 seconds in ms
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [expired, setExpired] = useState(false);

  // Update current time every 100ms
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // Compute elapsed time since the broadcast timestamp
  const elapsed = currentTime - question.timestamp;
  const timeLeftMs = Math.max(0, maxTime - elapsed);
  const timeLeftSec = (timeLeftMs / 1000).toFixed(1);
  const progressValue = (timeLeftMs / maxTime) * 100;

  // When time expires, trigger next question
  useEffect(() => {
    if (timeLeftMs <= 0 && !expired) {
      setExpired(true);
      onNextQuestion();
    }
  }, [timeLeftMs, expired, onNextQuestion]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">
            Question {currentIndex + 1} of {totalQuestions}
          </h2>
          <Badge variant="secondary" className="text-base">
            {totalResponses} {totalResponses === 1 ? "response" : "responses"}
          </Badge>
        </div>
        <p className="text-lg text-white">{question.questionText}</p>
      </div>

      <div className="space-y-2">
        <Progress value={progressValue} className="h-2" />
        <p className="text-sm  text-white text-muted-foreground text-center">
          {timeLeftSec} seconds remaining
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {question.answers.map((answer, index) => (
          <Card
            key={index}
            className="transition-colors hover:bg-muted/50 cursor-pointer"
          >
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-muted">
                  {String.fromCharCode(65 + index)}
                </div>
                <p className="text-lg">{answer}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-end">
        <Button size="lg" onClick={onNextQuestion}>
          Show Correct Answer
        </Button>
      </div>
    </div>
  );
}
