export interface QuizDetails {
  title: string;
  questions: {
    questionText: string;
    answers: string[];
    correctAnswerIndex: number;
    correctAnswers?: boolean[]; 
    type?: "single_select" | "multi_select";
    timestamp?: number;
  }[];
  tapSequence: string;
}

export interface Client {
  id: string;
  ip: string;
  name: string,
  score: number;
  authenticated: boolean;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
}