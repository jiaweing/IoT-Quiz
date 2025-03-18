import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface AnswerRevealProps {
  question: {
    questionText: string;
    answers: string[];
    correctAnswerIndex: number;
    correctAnswers?: boolean[];
    type?: "single_select" | "multi_select";
  };
  distribution: { [key: string]: number };
  totalClients: number;
  onRevealNext: () => void;
}


export function AnswerReveal({
  question,
  distribution,
  totalClients,
  onRevealNext,
}: AnswerRevealProps) {
  // Convert distribution object to array
  const distArray = question.answers.map((_, i) =>
    Number(distribution[(i + 1).toString()] || 0)
  );
  const totalResponses = distArray.reduce((sum, count) => sum + count, 0);
  const notAnswered = totalClients - totalResponses;
  // Add a function to determine if an answer is correct
  const isCorrectAnswer = (index: number) => {
    if (question.correctAnswers) {
      // Use the correctAnswers array if available
      return question.correctAnswers[index] === true;
    } else if (question.correctAnswerIndex !== undefined) {
      // Fall back to correctAnswerIndex for backward compatibility
      return index === question.correctAnswerIndex;
    }
    return false;
  };

  return (
    <div className="space-y-6 text-white">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">Answer Distribution</h2>
        <p className="text-lg">{question.questionText}</p>
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
      {question.answers.map((answer, index) => {
        const count = distArray[index] || 0;
        const percentage = totalResponses > 0 ? (count / totalResponses) * 100 : 0;
        const isCorrect = isCorrectAnswer(index);
          return (
            <Card
              key={index}
              className={`${
                index === question.correctAnswerIndex
                  ? "border-green-800 bg-green-400 dark:bg-green-900"
                  : ""
              }`}
            >
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                        index === question.correctAnswerIndex
                          ? "border-green-800 bg-green-200 dark:bg-green-700"
                          : "bg-muted"
                      }`}
                    >
                      {String.fromCharCode(65 + index)}
                    </div>
                    <p className="text-lg">{answer}</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>
                        {count} {count === 1 ? "response" : "responses"}
                      </span>
                      <span>{percentage.toFixed(1)}%</span>
                    </div>
                    <Progress
                      value={percentage}
                      className={`h-2 ${
                        index === question.correctAnswerIndex
                          ? "bg-green-200 dark:bg-green-900"
                          : "bg-gray-300 dark:bg-gray-600"
                      }`}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {question.type === "multi_select" && (
          <Badge variant="secondary" className="text-sm">
            Multiple correct answers
          </Badge>
        )}
      </div>

      <div className="flex justify-end">
        <Button size="lg" onClick={onRevealNext}>
          Next Question
        </Button>
      </div>
    </div>
  );
}

