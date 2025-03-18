import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { GradientBackground } from "@/components/ui/gradient-background";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QuizDetails } from "@/types/quiz";
import { useState } from "react";

interface CreateQuizModalProps {
  onClose: () => void;
  onCreate: (details: QuizDetails) => void;
}

export function CreateQuizModal({ onClose, onCreate }: CreateQuizModalProps) {
  const [title, setTitle] = useState("");
  const [tapSequence, setTapSequence] = useState("");
  const [questions, setQuestions] = useState([
    {
      questionText: "",
      answers: ["", "", "", ""],
      correctAnswerIndex: 0,
      correctAnswers: [false, false, false, false],
    type: "single_select" as "single_select" | "multi_select",
    },
  ]);
  const handleAddQuestion = () => {
    const newQuestions = [
      ...questions,
      {
        questionText: "",
        answers: ["", "", "", ""],
        correctAnswerIndex: 0,
        correctAnswers: [false, false, false, false],
        type: "single_select" as "single_select" | "multi_select",
      },
    ];
    console.log("Adding new question. Total questions:", newQuestions.length);
    setQuestions(newQuestions);
  };

  // Add a function to handle question type change
const handleQuestionTypeChange = (qIndex: number, type: string) => {
  const updated = [...questions];
  updated[qIndex].type = type as "single_select" | "multi_select";
  
  // If changing to single_select and multiple are selected, keep only the first selected
  if (type === "single_select") {
    const firstSelectedIndex = updated[qIndex].correctAnswers.indexOf(true);
    if (firstSelectedIndex !== -1) {
      updated[qIndex].correctAnswers = updated[qIndex].correctAnswers.map((_, i) => i === firstSelectedIndex);
      updated[qIndex].correctAnswerIndex = firstSelectedIndex;
    }
  }
  
  setQuestions(updated);
};

// Add a function to toggle correct answers
const toggleAnswerCorrect = (qIndex: number, ansIndex: number) => {
  const updated = [...questions];
  const question = updated[qIndex];
  
  if (question.type === "single_select") {
    // For single selection, uncheck all others
    question.correctAnswers = question.correctAnswers.map((_, i) => i === ansIndex);
    question.correctAnswerIndex = ansIndex;
  } else {
    // For multiple selection, toggle the current one
    question.correctAnswers[ansIndex] = !question.correctAnswers[ansIndex];
  }
  
  setQuestions(updated);
};

  const handleCreate = () => {
    onCreate({ title, questions, tapSequence });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-2xl mx-4">
        <header className="mb-6 text-center">
          <h1 className="text-4xl font-bold text-white flex items-center justify-center">
            Hello!{" "}
            <span role="img" aria-label="wave" className="ml-2">
              👋
            </span>
          </h1>
          <h2 className="text-3xl font-bold text-yellow-300 underline underline-offset-4 mt-2">
            Welcome to Quizzle
          </h2>
        </header>
        <Card className="w-full max-w-2xl">
          <CardContent className="p-6">
            <h2 className="text-2xl font-bold mb-6">Create Quiz</h2>
            <div className="space-y-6">
              <div className="space-y-2">
                <Label>Quiz Title</Label>
                <Input
                  placeholder="Enter quiz title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Auth Sequence</Label>
                <Input
                  placeholder="Enter Auth Sequence (E.g. ABA)"
                  value={tapSequence}
                  onChange={(e) => setTapSequence(e.target.value)}
                />
              </div>

            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
              {questions.map((q, qIndex) => (
                <Card key={qIndex} className="p-4">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Question {qIndex + 1}</Label>
                      <Input
                        placeholder="Enter question"
                        value={q.questionText}
                        onChange={(e) => {
                          const updated = [...questions];
                          updated[qIndex].questionText = e.target.value;
                          setQuestions(updated);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Question Type</Label>
                      <Select
                        value={q.type}
                        onValueChange={(value) => handleQuestionTypeChange(qIndex, value)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select question type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="single_select">Single Answer</SelectItem>
                          <SelectItem value="multi_select">Multiple Answers</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {q.answers.map((ans, ansIndex) => (
                        <div key={ansIndex} className="space-y-2 border p-3 rounded-md">
                          <div className="flex items-center justify-between">
                            <Label>Answer {ansIndex + 1}</Label>
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id={`q${qIndex}-a${ansIndex}`}
                                checked={q.correctAnswers[ansIndex]}
                                onCheckedChange={() => toggleAnswerCorrect(qIndex, ansIndex)}
                              />
                              <Label htmlFor={`q${qIndex}-a${ansIndex}`} className="text-sm font-normal">
                                Correct
                              </Label>
                            </div>
                          </div>
                          <Input
                            placeholder={`Option ${ansIndex + 1}`}
                            value={ans}
                            onChange={(e) => {
                              const updated = [...questions];
                              updated[qIndex].answers[ansIndex] = e.target.value;
                              setQuestions(updated);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              ))}
              </div>
            </ScrollArea>

              <div className="flex flex-col sm:flex-row gap-2 justify-between">
                <Button onClick={handleAddQuestion} variant="secondary">
                  Add Question
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreate}>Create Quiz</Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}