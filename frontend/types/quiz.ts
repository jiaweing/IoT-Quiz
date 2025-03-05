export interface QuizDetails {
  title: string;
  questions: {
    questionText: string;
    answers: string[];
    correctAnswerIndex: number;
    timestamp?: number;
  }[];
}

export interface Client {
  id: string;
  ip: string;
  score: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
}
