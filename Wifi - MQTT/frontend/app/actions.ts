"use server";

import { QuizDetails } from "@/types/quiz";

const API_BASE = "https://localhost:3001/api/quiz";

/**
 * Creates a new quiz session.
 * 
 * - Transforms quiz questions to ensure required fields are present.
 * - Sends a POST request to the /create endpoint.
 * 
 * @param sessionName - The name for the new quiz session.
 * @param quizQuestions - Array of quiz questions.
 * @param tapSequence - The tap sequence used for authorization.
 * @returns A promise resolving to the JSON response from the API.
 */
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

/**
 * Starts a quiz session.
 * 
 * - Sends a POST request to the /start endpoint with the session ID.
 * 
 * @param sessionId - The session ID to start.
 * @returns A promise resolving to the JSON response from the API.
 */
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

/**
 * Allows clients to join a quiz session by broadcasting the auth sequence.
 * 
 * - Sends a POST request to the /auth endpoint.
 * 
 * @param sessionId - The session ID for which joining is allowed.
 * @returns A promise resolving to the JSON response from the API.
 */
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

/**
 * Broadcasts a question to the quiz session.
 * 
 * - Sends a POST request to the /broadcast endpoint with the session ID and question index.
 * 
 * @param sessionId - The session ID for the quiz.
 * @param questionIndex - The index of the question to broadcast.
 * @returns A promise resolving to the JSON response from the API.
 */
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

/**
 * Closes the current question.
 * 
 * - Sends a POST request to the /close-question endpoint with the session ID and question ID.
 * - Logs any error text from the response if it fails.
 * 
 * @param sessionId - The session ID.
 * @param questionId - The ID of the question to close.
 * @returns A promise resolving to the JSON response from the API.
 */
export async function closeQuestion(sessionId: string, questionId: string) {
  console.log("Closing question with sessionId:", sessionId, "and questionId:", questionId);
  const response = await fetch(`${API_BASE}/close-question`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, questionId }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to close question: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}


/**
 * Retrieves the leaderboard for a quiz session.
 * 
 * - Sends a GET request to the /leaderboard endpoint with the session ID as a query parameter.
 * 
 * @param sessionId - The session ID.
 * @returns A promise resolving to the leaderboard data in JSON format.
 */
export async function getLeaderboard(sessionId: string) {
  const response = await fetch(
    `${API_BASE}/leaderboard?sessionId=${sessionId}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch leaderboard: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Ends the quiz session.
 * 
 * - Sends a POST request to the /end endpoint with the session ID.
 * 
 * @param sessionId - The session ID to end.
 * @returns A promise resolving to the JSON response from the API.
 */
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

/**
 * Resets the quiz session.
 * 
 * - Sends a POST request to the /reset-quiz endpoint with the session ID.
 * - This is used when restarting the quiz with the same questions.
 * 
 * @param sessionId - The session ID to reset.
 * @returns A promise resolving to the JSON response from the API.
 */
export async function resetQuiz(sessionId: string) {
  const response = await fetch(`${API_BASE}/reset-quiz`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  return response.json();
}