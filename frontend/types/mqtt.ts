export interface ClientInfo {
  id: string;
  ip: string;
  session?: string;
  score?: number;
  authenticated: boolean;
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
