import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import React from "react";
import { DistributionPayload } from "@/types/mqtt";

interface QuestionPayload {
  id: string;
  questionText: string;
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  type?: "single_select" | "multi_select";
  timestamp?: number;
}

interface AnswerRevealProps {
  broadcastQuestion: QuestionPayload;
  distribution: DistributionPayload;
  totalClients: number;
  onRevealNext: () => void;
}

export function AnswerReveal({
  broadcastQuestion,
  distribution,
  totalClients,
  onRevealNext,
}: AnswerRevealProps) {
  const options = broadcastQuestion.options;
  // Convert distribution object to array
  const distArray = options.map((option) => Number(distribution.distribution[option.id] || 0));
  
  const totalResponses = broadcastQuestion.type === "multi_select"
  ? distribution.uniqueRespondents
  : distArray.reduce((sum, count) => sum + count, 0);
  const totalSelections = distArray.reduce((sum, count) => sum + count, 0);
  const notAnswered = totalClients - totalResponses;


  const isCorrectOption = (optionId: string) => {
    return broadcastQuestion.correctOptionIds.includes(optionId);
  };

  return (
    <div className="space-y-6 text-white">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">Answer Distribution</h2>
        <p className="text-lg">{broadcastQuestion.questionText}</p>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-base text-white">
          {totalResponses} {totalResponses === 1 ? "response" : "responses"}
        </Badge>
        <Badge variant="secondary" className="text-base">
          {notAnswered} not answered
        </Badge>
      </div>

      <div className="grid gap-4">
        {options.map((option, index) => {
            const count = distArray[index] || 0;
            const percentage = totalSelections > 0 ? (count / totalSelections) * 100 : 0;
            const correct = isCorrectOption(option.id);
          
          return (
            <Card
              key={index}
              className={`${
                correct
                  ? "border-green-800 bg-green-400 dark:bg-green-900"
                  : ""
              }`}
            >
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                        correct
                          ? "border-green-800 bg-green-200 dark:bg-green-700"
                          : "bg-muted"
                      }`}
                    >
                      {String.fromCharCode(65 + index)}
                    </div>
                    <p className="text-lg">{option.text}</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>
                        {count} {count === 1 ? "selection" : "selections"}
                      </span>
                      <span>{percentage.toFixed(1)}%</span>
                    </div>
                    <Progress
                      value={percentage}
                      className={`h-2 ${
                        correct
                          ? "bg-green-200 dark:bg-green-900"
                          : "bg-gray-300 dark:bg-gray-600"
                      }`}
                      style={{
                        "--progress-indicator-color": 
                          correct
                            ? "#ffffff" // e.g. green-300 for correct answers
                            : "#4b5563" // e.g. gray-300 for incorrect answers
                      } as React.CSSProperties}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button size="lg" onClick={onRevealNext}>
          Next Question
        </Button>
      </div>
    </div>
  );
}
