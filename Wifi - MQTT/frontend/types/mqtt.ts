export interface ClientInfo {
  id: string;
  ip: string;
  name: string;
  session?: string;
  score: number;
  authenticated: boolean;
  authorized: boolean
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

export interface DistributionPayload {
  distribution: { [key: string]: number };
  uniqueRespondents: number;
}
