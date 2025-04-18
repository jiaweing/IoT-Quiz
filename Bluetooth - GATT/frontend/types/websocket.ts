export interface ClientInfo {
  id: string;
  name: string;
  session?: string;
  score?: number;
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