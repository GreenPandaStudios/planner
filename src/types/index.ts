export interface Person {
  id: string;
  name: string;
  relationship?: string; // e.g., "Boss", "Partner", "Client"
  notes?: string;        // e.g., "Always protect these requests"
  createdAt: number;
}

export interface TaskMetadata {
  energyLevel?: 'high' | 'medium' | 'low';
  domain?: 'work' | 'personal' | 'health' | 'other';
  sentiment?: 'neutral' | 'dreaded' | 'excited' | 'routine';
  urgency?: 'critical' | 'flexible';
  deadline?: string;
  priority?: 'high' | 'medium' | 'low';
  aiEnriched?: boolean;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  points: 1 | 2 | 3 | 5 | 8;
  week: string; // Format: "YYYY-[W]WW" (e.g., "2026-W22")
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';
  status: 'todo' | 'in-progress' | 'done';
  createdAt: number;
  completedAt?: number;
  requestedBy?: string; // Links to Person.name
  metadata?: TaskMetadata;
}

export interface AppSettings {
  openaiApiKey: string;
  githubPat: string;
  gistId: string;
  weeklyPointsLimit: number; // default: 30
}

export type Weekday = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';

export const WEEKDAYS: Weekday[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export interface AgentChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: number;
}

