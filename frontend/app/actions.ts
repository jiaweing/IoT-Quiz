"use server";

import { QuizDetails } from "@/types/quiz";

const API_BASE = "http://localhost:3001/api/quiz";

export async function createQuiz(
  sessionName: string,
  quizQuestions: QuizDetails["questions"]
) {
  const response = await fetch(`${API_BASE}/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionName, quizQuestions }),
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
