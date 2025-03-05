export interface QuizDetails {
  title: string;
  questions: {
    questionText: string;
    answers: string[];
    correctAnswerIndex: number;
    timestamp?: number;
  }[];
  tapSequence: string;
}

export interface Client {
  id: string;
  ip: string;
  score: number;
  authenticated: boolean;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
}
