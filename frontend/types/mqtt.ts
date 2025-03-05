export interface ClientInfo {
  id: string;
  ip: string;
  score?: number;
}

export interface BroadcastQuestion {
  questionText: string;
  answers: string[];
  correctAnswerIndex: number;
  timestamp: number;
}

export interface AnswerDistribution {
  [key: string]: number;
}
