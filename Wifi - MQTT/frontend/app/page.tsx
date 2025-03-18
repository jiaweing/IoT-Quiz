"use client";

import { AnswerReveal } from "@/components/quiz/answer-reveal";
import { ConnectedPlayers } from "@/components/quiz/connected-players";
import { CreateQuizModal } from "@/components/quiz/create-quiz-modal";
import { Leaderboard } from "@/components/quiz/leaderboard";
import { QuestionPage } from "@/components/quiz/question-page";
import { useMqtt } from "@/hooks/use-mqtt";
import { ClientInfo } from "@/types/mqtt";
import { LeaderboardEntry, QuizDetails } from "@/types/quiz";
import { useState } from "react";
import * as actions from "./actions";
import { GradientBackground } from "@/components/ui/gradient-background";

// Quiz flow steps
enum Step {
  CREATE_QUIZ = 1,
  CONNECTED_PLAYERS,
  QUESTION_PAGE,
  ANSWER_REVEAL,
  LEADERBOARD,
}

export default function QuizHost() {
  const {
    clients,
    isConnected,
    totalClients,
    answerDistribution,
    broadcastQuestion,
    setClients,
    setTotalClients,
    setSessionStatus,
    setAnswerDistribution,
    setBroadcastQuestion
  } = useMqtt();

  const [step, setStep] = useState<Step>(Step.CREATE_QUIZ);
  const [quizDetails, setQuizDetails] = useState<QuizDetails | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(true);

  const totalResponses =
  answerDistribution && broadcastQuestion
    ? broadcastQuestion.type === "multi_select"
      ? answerDistribution.uniqueRespondents
      : Object.values(answerDistribution.distribution).reduce((sum, val) => sum + Number(val), 0)
    : 0;


  // Handle quiz creation
  const handleCreateQuiz = async (details: QuizDetails) => {
    try {
      const formattedQuestions = details.questions.map(q => ({
        ...q,
        // Add default values for the new required fields if they don't exist
        correctAnswers: q.correctAnswers ||
          q.answers.map((_, i) => i === q.correctAnswerIndex),
        type: q.type || "single_select"
      }));
      const data = await actions.createQuiz(details.title, details.questions, details.tapSequence);
      setQuizDetails({
        ...details,
        questions: formattedQuestions
      });
      setSessionId(data.sessionId);
      setShowCreateModal(false);
      setStep(Step.CONNECTED_PLAYERS);
    } catch (error) {
      console.error("Failed to create quiz:", error);
    }
  };

  // Start quiz session
  const startSession = async () => {
    if (!sessionId || !quizDetails) return;
    try {
      await actions.startQuizSession(sessionId);
      setStep(Step.QUESTION_PAGE);
    } catch (error) {
      console.error("Failed to start session:", error);
    }
  };

  const handleAllowJoining = async () => {
    if (!sessionId || !quizDetails) return;
    try {
      await actions.allowJoining(sessionId);
    } catch (error) {
      console.error("Failed to broadcast auth code:", error);
    }
  };


  // Handle showing answer
  const handleNextQuestion = () => {
    if (!quizDetails) return;
    setStep(Step.ANSWER_REVEAL);
  };

  // Handle next question or end quiz
  const handleRevealNext = async () => {
    if (!sessionId || !quizDetails) return;
    const nextIndex = currentQuestionIndex + 1;

    if (nextIndex < quizDetails.questions.length) {
      try {
        await actions.broadcastQuestion(sessionId, nextIndex);
        setCurrentQuestionIndex(nextIndex);
        setStep(Step.QUESTION_PAGE);
      } catch (error) {
        console.error("Failed to broadcast next question:", error);
      }
    } else {
      try {
        const leaderboardData = await actions.getLeaderboard(sessionId);
        setLeaderboard(leaderboardData);
        setStep(Step.LEADERBOARD);
      } catch (error) {
        console.error("Failed to fetch leaderboard:", error);
      }

      try {
        await actions.endQuizSession(sessionId);
      } catch (error) {
        console.error("Failed to broadcast session end:", error);
      }
    }
  };

  // Handle restarting quiz with same questions
  const handleRestartSame = async () => {
    if (!quizDetails || !sessionId) return;
    
    setCurrentQuestionIndex(0);
    setLeaderboard([]);
    setAnswerDistribution({ distribution: {}, uniqueRespondents: 0 });
    setBroadcastQuestion(null)
    try {
      const data = await actions.createQuiz(
        quizDetails.title,
        quizDetails.questions,
        quizDetails.tapSequence
      );
      setSessionId(data.sessionId);
      await actions.resetQuiz(data.sessionId);
      setStep(Step.CONNECTED_PLAYERS);
    } catch (error) {
      console.error("Failed to restart quiz:", error);
    }
  };

  // Handle starting new quiz
  const handleRestartNew = () => {
    setQuizDetails(null);
    setSessionId(null);
    setBroadcastQuestion(null)
    setCurrentQuestionIndex(0);
    setLeaderboard([]);
    setShowCreateModal(true);
    setAnswerDistribution({ distribution: {}, uniqueRespondents: 0 });
    setClients([])
    setSessionStatus("pending")
    setStep(Step.CREATE_QUIZ);
  };

  // Transform ClientInfo[] to Client[] by ensuring score is a number
  const connectedClients = clients.map((client: ClientInfo) => ({
    ...client,
    score: client.score || 0,
    authenticated: client.authenticated ?? false, // default value if missing
  }));

  const authenticatedClients = connectedClients.filter(client => client.authenticated);
  const authenticatedClientsCount = connectedClients.filter(client => client.authenticated).length;
  return (
    <GradientBackground className="flex flex-col items-center justify-center">
      <main className="w-full max-w-4xl p-6">
        <div className="w-full">
          {showCreateModal && step === Step.CREATE_QUIZ && (
            <CreateQuizModal
              onClose={() => setShowCreateModal(false)}
              onCreate={handleCreateQuiz}
            />
          )}

          {step === Step.CONNECTED_PLAYERS && quizDetails && (
            <ConnectedPlayers
              expectedTapSequence={quizDetails?.tapSequence || ""}
              clients={authenticatedClients}
              isConnected={isConnected}
              totalClients={authenticatedClientsCount}
              quizTitle={quizDetails.title}
              startSession={startSession}
              allowJoining={handleAllowJoining}
            />
          )}

          {step === Step.QUESTION_PAGE && quizDetails && (
            <QuestionPage
              question={{
                ...quizDetails.questions[currentQuestionIndex],
                timestamp: broadcastQuestion?.timestamp,
              }}
              currentIndex={currentQuestionIndex}
              totalQuestions={quizDetails.questions.length}
              onNextQuestion={handleNextQuestion}
              totalResponses={totalResponses}
            />
          )}

          {step === Step.ANSWER_REVEAL && quizDetails && (
            <AnswerReveal
              broadcastQuestion={broadcastQuestion}
              distribution={answerDistribution || { distribution: {}, uniqueRespondents: 0 }}
              totalClients={totalClients}
              onRevealNext={handleRevealNext}
            />
          )}

          {step === Step.LEADERBOARD && (
            <Leaderboard
              leaderboard={leaderboard}
              onRestartSame={handleRestartSame}
              onRestartNew={handleRestartNew}
            />
          )}
        </div>
      </main>
    </GradientBackground>
  );
}
