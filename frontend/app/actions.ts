"use server";

import { QuizDetails } from "@/types/quiz";

const API_BASE = "https://localhost:3001/api/quiz";

export async function createQuiz(
  sessionName: string,
  quizQuestions: QuizDetails["questions"],
  tapSequence: QuizDetails["tapSequence"]
) {
  // Transform questions to ensure they have all required fields
  const formattedQuestions = quizQuestions.map(q => ({
    ...q,
    correctAnswers: q.correctAnswers || q.answers.map((_, i) => i === q.correctAnswerIndex),
    type: q.type || "single_select"
  }));
  const response = await fetch(`${API_BASE}/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionName, quizQuestions: formattedQuestions, tapSequence }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create quiz: ${response.statusText}`);
  }

  return response.json();
}

export async function startQuizSession(sessionId: string) {
  const response = await fetch(`${API_BASE}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to start quiz: ${response.statusText}`);
  }

  return response.json();
}

export async function allowJoining(sessionId: string) {
  const response = await fetch(`${API_BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to broadcast authorization sequence: ${response.statusText}`);
  }

  return response.json();
}



export async function broadcastQuestion(
  sessionId: string,
  questionIndex: number
) {
  const response = await fetch(`${API_BASE}/broadcast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, questionIndex }),
  });

  if (!response.ok) {
    throw new Error(`Failed to broadcast question: ${response.statusText}`);
  }

  return response.json();
}

export async function getLeaderboard(sessionId: string) {
  const response = await fetch(
    `${API_BASE}/leaderboard?sessionId=${sessionId}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch leaderboard: ${response.statusText}`);
  }

  return response.json();
}

export async function endQuizSession(sessionId: string) {
  const response = await fetch(`${API_BASE}/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });

  if (!response.ok) {
    throw new Error(`Failed to broadcast session end: ${response.statusText}`);
  }

  return response.json();
}