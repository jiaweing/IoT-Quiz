// pages/index.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useMqtt } from "@/hooks/use-mqtt";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card } from "../components/ui/card";

// Quiz data
interface QuizDetails {
  title: string;
  questions: {
    questionText: string;
    answers: string[];
    correctAnswerIndex: number;
  }[];
}

// Quiz flow steps
enum Step {
  CREATE_QUIZ = 1,
  CONNECTED_PLAYERS,
  QUESTION_PAGE,
  ANSWER_REVEAL,
  LEADERBOARD,
}

export default function Home() {
  const { clients, isConnected, totalClients, publish, answerDistribution } = useMqtt();

  const [step, setStep] = useState<Step>(Step.CREATE_QUIZ);
  const [quizDetails, setQuizDetails] = useState<QuizDetails | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // Calculate total responses from the distribution object.
  const totalResponses = Object.values(answerDistribution).reduce(
    (sum, val) => sum + Number(val),
    0
  );

  // Step 1: Create Quiz Modal – creates session, questions, and options in DB
  const [showCreateModal, setShowCreateModal] = useState(true);
  const handleCreateQuiz = async (details: QuizDetails) => {
    try {
      const response = await fetch("http://localhost:3001/api/quiz/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionName: details.title, quizQuestions: details.questions }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      console.log("✅ Quiz created:", data);
      setQuizDetails(details);
      setSessionId(data.sessionId);
      setShowCreateModal(false);
      setStep(Step.CONNECTED_PLAYERS);
    } catch (error) {
      console.error("🚨 Failed to create quiz:", error);
    }
  };

  // Step 2: Connected Players – start the session
  const startSession = async () => {
    if (!sessionId || !quizDetails) {
      console.error("No session ID or quiz details available");
      return;
    }
    try {
      const response = await fetch("http://localhost:3001/api/quiz/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      console.log("✅ Session started:", data);
      publish("quiz/session/start", quizDetails.title);
      setStep(Step.QUESTION_PAGE);
    } catch (error) {
      console.error("🚨 Failed to start session:", error);
    }
  };

  // Step 3: Display question page
  const handleNextQuestion = () => {
    if (!quizDetails) return;
    setStep(Step.ANSWER_REVEAL);
  };

  // Step 4: Answer reveal step and Next Question
  const handleRevealNext = async () => {
    if (!sessionId || !quizDetails) return;
    const nextIndex = currentQuestionIndex + 1;
    if (nextIndex < quizDetails.questions.length) {
      try {
        const response = await fetch("http://localhost:3001/api/quiz/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, questionIndex: nextIndex }),
        });
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();
        console.log("✅ Broadcasted next question:", data);
        setCurrentQuestionIndex(nextIndex);
        setStep(Step.QUESTION_PAGE);
      } catch (error) {
        console.error("🚨 Failed to broadcast next question:", error);
      }
    } else {
      console.log("No more questions available. Ending quiz.");
      setStep(Step.LEADERBOARD);
    }
  };

  // Step 5: Leaderboard is fetched when the quiz ends.
  useEffect(() => {
    if (step === Step.LEADERBOARD && sessionId) {
      (async () => {
        try {
          const response = await fetch(`http://localhost:3001/api/quiz/leaderboard?sessionId=${sessionId}`);
          const data = await response.json();
          setLeaderboard(data);
        } catch (error) {
          console.error("Failed to fetch leaderboard:", error);
        }
      })();
    }
  }, [step, sessionId]);

  return (
    <main className="container mx-auto py-10 p-6">
      {showCreateModal && step === Step.CREATE_QUIZ && (
        <CreateQuizModal onClose={() => setShowCreateModal(false)} onCreate={handleCreateQuiz} />
      )}
      {step === Step.CONNECTED_PLAYERS && quizDetails && (
        <ConnectedPlayersStep
          clients={clients}
          isConnected={isConnected}
          totalClients={totalClients}
          quizTitle={quizDetails.title}
          startSession={startSession}
        />
      )}
      {step === Step.QUESTION_PAGE && quizDetails && (
        <QuestionPage
          question={quizDetails.questions[currentQuestionIndex]}
          currentIndex={currentQuestionIndex}
          totalQuestions={quizDetails.questions.length}
          onNextQuestion={handleNextQuestion}
          totalResponses={totalResponses}
        />
      )}
      {step === Step.ANSWER_REVEAL && quizDetails && (
        <AnswerRevealPage
          question={quizDetails.questions[currentQuestionIndex]}
          distribution={answerDistribution}
          totalClients={totalClients}
          onRevealNext={handleRevealNext}
        />
      )}
      {step === Step.LEADERBOARD && (
        <LeaderboardPage leaderboard={leaderboard} />
      )}
    </main>
  );
}

function CreateQuizModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (details: {
    title: string;
    questions: {
      questionText: string;
      answers: string[];
      correctAnswerIndex: number;
    }[];
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState([
    {
      questionText: "",
      answers: ["", "", "", ""],
      correctAnswerIndex: 0,
    },
  ]);

  const handleAddQuestion = () => {
    setQuestions((prev) => [
      ...prev,
      { questionText: "", answers: ["", "", "", ""], correctAnswerIndex: 0 },
    ]);
  };

  const handleCreate = () => {
    onCreate({ title, questions });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white p-6 rounded w-full max-w-xl">
        <h2 className="text-xl font-bold mb-4">Create Quiz</h2>
        <label className="block mb-2">
          Title:
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <h3 className="font-semibold mb-2 mt-4">Questions:</h3>
        {questions.map((q, qIndex) => (
          <div key={qIndex} className="mb-4 border p-2 rounded">
            <label className="block mb-1">
              Question Text:
              <Input
                value={q.questionText}
                onChange={(e) => {
                  const updated = [...questions];
                  updated[qIndex].questionText = e.target.value;
                  setQuestions(updated);
                }}
              />
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {q.answers.map((ans, ansIndex) => (
                <label key={ansIndex}>
                  Answer {ansIndex + 1}:
                  <Input
                    value={ans}
                    onChange={(e) => {
                      const updated = [...questions];
                      updated[qIndex].answers[ansIndex] = e.target.value;
                      setQuestions(updated);
                    }}
                  />
                </label>
              ))}
            </div>
            <label className="block mt-2">
              Correct Answer Index:
              <select
                value={q.correctAnswerIndex}
                onChange={(e) => {
                  const updated = [...questions];
                  updated[qIndex].correctAnswerIndex = Number(e.target.value);
                  setQuestions(updated);
                }}
              >
                {q.answers.map((_, i) => (
                  <option key={i} value={i}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
        <Button onClick={handleAddQuestion} variant="secondary" className="mr-2">
          + Add Another Question
        </Button>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate}>Create Quiz</Button>
        </div>
      </div>
    </div>
  );
}

function ConnectedPlayersStep({
  clients,
  isConnected,
  totalClients,
  quizTitle,
  startSession,
}: {
  clients: any[];
  isConnected: boolean;
  totalClients: number;
  quizTitle: string;
  startSession: () => void;
}) {
  return (
    <>
      <h1 className="text-2xl font-bold mb-4">Connected Players</h1>
      <div className="flex items-center gap-4 mb-6">
        <p className="text-lg font-semibold">Quiz Title: {quizTitle}</p>
        <Button onClick={startSession}>Start Quiz</Button>
      </div>
      <div className="flex items-center gap-4 mb-4">
        {/* Connection status indicator */}
        <span className="relative inline-flex h-3 w-3">
          {isConnected && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
          )}
          <span
            className={`relative inline-flex h-3 w-3 rounded-full ${
              isConnected ? "bg-green-500" : "bg-red-500"
            }`}
          ></span>
        </span>
        <span><strong>Status:</strong> {isConnected ? "Connected" : "Disconnected"}</span>
        <span><strong>Total Clients:</strong> {totalClients}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {clients.length ? (
          clients.map((client) => (
            <Card key={client.id} className="p-4">
              <h3 className="font-semibold">Player: {client.id}</h3>
              <p className="text-sm">IP: {client.ip}</p>
              <p className="mt-2">Score: {client.score || 0}</p>
            </Card>
          ))
        ) : (
          <Card className="p-4 col-span-full">
            <p className="text-center text-gray-500">No connected players</p>
          </Card>
        )}
      </div>
    </>
  );
}

function QuestionPage({
  question,
  currentIndex,
  totalQuestions,
  onNextQuestion,
  totalResponses,
}: {
  question: {
    questionText: string;
    answers: string[];
    correctAnswerIndex: number;
  };
  currentIndex: number;
  totalQuestions: number;
  onNextQuestion: () => void;
  totalResponses: number;
}) {
  return (
    <>
      <h2 className="text-xl font-bold mb-2">
        Question {currentIndex + 1} of {totalQuestions} ({totalResponses} responses)
      </h2>
      <p className="mb-4">{question.questionText}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {question.answers.map((ans, i) => (
          <Card key={i} className="p-4">
            <p>{ans}</p>
          </Card>
        ))}
      </div>
      <div className="mt-4">
        <Button onClick={onNextQuestion}>Show Correct Answer</Button>
      </div>
    </>
  );
}

function AnswerRevealPage({ question, distribution, totalClients, onRevealNext, }: { 
  question: { questionText: string; answers: string[]; correctAnswerIndex: number; }; 
  distribution: { [key: string]: number }; 
  totalClients: number; 
  onRevealNext: () => void; 
}) {
  // Convert distribution object with keys "1"..."4" to an array (mapped to answer indices 0-3)
  const distArray = question.answers.map((_, i) => Number(distribution[(i + 1).toString()] || 0));
  const totalResponses = distArray.reduce((sum, count) => sum + count, 0);
  const notAnswered = totalClients - totalResponses;
  return (
    <>
      <h2 className="text-xl font-bold mb-2">Answer Distribution</h2>
      <p className="mb-4">{question.questionText}</p>
      <div className="mb-4">
        <p>Not Answered: {notAnswered} out of {totalClients} connected</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {question.answers.map((ans, i) => {
          const count = distArray[i] || 0;
          const percentage = totalResponses > 0 ? ((count / totalResponses) * 100).toFixed(1) : "0";
          return (
            <Card key={i} className={`p-4 border rounded ${i === question.correctAnswerIndex ? "bg-green-200" : ""}`}>
              <p>{ans}</p>
              <p>{count} responses ({percentage}%)</p>
            </Card>
          );
        })}
      </div>
      <div className="mt-4">
        <Button onClick={onRevealNext}>Next Question</Button>
      </div>
    </>
  );
}


function LeaderboardPage({ leaderboard }: { leaderboard: any[] }) {
  return (
    <>
      <h2 className="text-2xl font-bold mb-4">Quiz Finished!</h2>
      <p className="mb-4">Final Leaderboard:</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {leaderboard.length ? (
          leaderboard.map((player, index) => (
            <Card key={player.id} className="p-4">
              <h3 className="font-semibold">{index + 1}. {player.name}</h3>
              <p className="text-lg text-green-600">{player.score} Points</p>
            </Card>
          ))
        ) : (
          <Card className="p-4 col-span-full">
            <p className="text-center text-gray-500">No scores yet</p>
          </Card>
        )}
      </div>
    </>
  );
}
