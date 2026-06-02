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
  day?: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';
  status: 'todo' | 'in-progress' | 'done';
  createdAt: number;
  completedAt?: number;
  requestedBy?: string; // Links to Person.name
  metadata?: TaskMetadata;
  parentProject?: string; // Name of the parent task this was broken from
  today?: boolean; // Scheduled for Focus Today
  delegated?: boolean; // Has this task been delegated
  delegatedTo?: string; // Who this task was delegated to
  triaging?: boolean; // Is the task currently being triaged by AI in the background
  carriedOver?: boolean; // Has this task been carried over from a previous day
}

export interface AppSettings {
  openaiApiKey: string;
  githubPat: string;
  gistId: string;
  weeklyPointsLimit: number; // default: 30
  dailyPointsLimit: number; // default: 7
  customTriagePrompt: string; // User instructions for triage/AI Coach
  userName?: string;
}

export type Weekday = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';

export const WEEKDAYS: Weekday[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export interface AgentChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: number;
}

