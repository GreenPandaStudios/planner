import type { Task, AppSettings } from '../types';

export interface TriageResult {
  title: string;
  points: 1 | 2 | 3 | 5 | 8;
  weekOffset: number; // 0 = this week, 1 = next week, etc.
  today?: boolean;
  reasoning?: string; // silent, never shown
}

// Get ISO week with an offset
export function getOffsetWeekFromNow(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset * 7);
  const tempDate = new Date(d.valueOf());
  tempDate.setDate(tempDate.getDate() + 4 - (tempDate.getDay() || 7));
  const yearStart = new Date(tempDate.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((tempDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${tempDate.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ---- Local heuristic fallback ----
export function triageLocally(rawTitle: string, currentWeek: string): TriageResult & { week: string } {
  const lower = rawTitle.toLowerCase();

  // Today parsing
  let today = false;
  if (/\btoday\b/.test(lower)) {
    today = true;
  }

  // Week offset
  let weekOffset = 0;
  if (/\bnext week\b/.test(lower)) weekOffset = 1;
  else if (/\bthis month\b|\bend of month\b|\bmonth\b/.test(lower)) weekOffset = 2;
  else if (/\bnext month\b/.test(lower)) weekOffset = 4;

  // Points
  let points: 1 | 2 | 3 | 5 | 8;
  const ptMatch = lower.match(/\b(1|2|3|5|8)\s*(?:pts?|points?)?\b/);
  if (ptMatch) {
    points = parseInt(ptMatch[1]) as 1 | 2 | 3 | 5 | 8;
  } else if (/\b(write|code|build|design|debug|study|create|report|presentation|strategy|pitch|review|test|refactor|research|plan)\b/.test(lower)) {
    points = 3;
  } else if (/\b(email|admin|clean|organize|call|check|update|meeting|schedule|log|buy|order)\b/.test(lower)) {
    points = 1;
  } else if (/\b(project|epic|launch|deploy|migrate|overhaul|rewrite)\b/.test(lower)) {
    points = 5;
  } else {
    points = 2;
  }

  // Clean title
  let title = rawTitle;
  title = title.replace(/\b(next week|this week|this month|next month|today|tomorrow)\b/gi, '');
  title = title.replace(/\b(?:1|2|3|5|8)\s*(?:pts?|points?)\b/gi, '');
  title = title.replace(/\s+/g, ' ').trim();
  if (!title) title = rawTitle.trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);

  const week = weekOffset === 0 ? currentWeek : getOffsetWeekFromNow(weekOffset);

  return { title, points, weekOffset, today, week };
}

// ---- AI-powered triage ----
export async function triageWithAI(
  rawTitle: string,
  currentWeek: string,
  settings: AppSettings,
  existingTasks: Task[],
): Promise<(TriageResult & { week: string }) | null> {
  if (!settings.openaiApiKey) return null;

  // Build brief context for the model
  const weekTasks = existingTasks
    .filter(t => t.week === currentWeek && t.status !== 'done')
    .map(t => `- "${t.title}" (${t.points} pts, today: ${t.today ? 'yes' : 'no'})`)
    .join('\n') || '(none)';

  const userInstructions = settings.customTriagePrompt
    ? `\nAdditional user guidelines / instructions:\n${settings.customTriagePrompt}\n`
    : '';

  const prompt = `You are a silent scheduling assistant. Given a task written in natural language, output a JSON object to schedule it onto a weekly planner.

Current week: ${currentWeek}.

Current week's tasks:
${weekTasks}

Weekly capacity limit: ${settings.weeklyPointsLimit} points.
Daily capacity limit: ${settings.dailyPointsLimit} points.

Rules:
1. Parse deadline hints like "this month", "next week", "today", "ASAP" to pick weekOffset (0=this week, 1=next week, 2=two weeks out, etc.) and "today" (true/false)
2. If this week is already at/near capacity, push to next week automatically.
3. Clean up the title: remove day/week/point hints from the raw text.
4. Size points by effort: 1=quick admin, 2=minor task, 3=focus block, 5=big project, 8=epic.
${userInstructions}
Respond with ONLY valid JSON, no commentary:
{
  "title": "cleaned task title",
  "points": 1|2|3|5|8,
  "today": true|false,
  "weekOffset": 0|1|2|3|4
}

Task to schedule: "${rawTitle}"`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const parsed = JSON.parse(data.choices[0].message.content);

    const offset = typeof parsed.weekOffset === 'number' ? parsed.weekOffset : 0;
    const week = offset === 0 ? currentWeek : getOffsetWeekFromNow(offset);
    const today = !!parsed.today;
    const validPoints = [1, 2, 3, 5, 8];
    const points = (validPoints.includes(parsed.points) ? parsed.points : 2) as 1 | 2 | 3 | 5 | 8;

    return {
      title: (parsed.title || rawTitle).trim(),
      points,
      today,
      weekOffset: offset,
      week,
    };
  } catch {
    return null;
  }
}

// ---- Silent overflow rebalancer ----
export async function silentRebalance(
  tasks: Task[],
  weekStr: string,
  limit: number,
  _apiKey: string,
): Promise<{ taskId: string; toWeek: string; label: string }[]> {
  void _apiKey;
  const weekTasks = tasks
    .filter(t => t.week === weekStr && t.status !== 'done')
    .sort((a, b) => {
      const prioA = a.metadata?.priority === 'high' ? 2 : a.metadata?.priority === 'medium' ? 1 : 0;
      const prioB = b.metadata?.priority === 'high' ? 2 : b.metadata?.priority === 'medium' ? 1 : 0;
      return prioA - prioB;
    });

  const total = weekTasks.reduce((s, t) => s + t.points, 0);
  if (total <= limit) return [];

  const nextWeek = getOffsetWeekFromNow(1);
  const moves: { taskId: string; toWeek: string; label: string }[] = [];
  let runningTotal = total;

  for (const task of weekTasks) {
    if (runningTotal <= limit) break;
    if (task.metadata?.priority === 'high' || task.metadata?.urgency === 'critical') continue;
    moves.push({ taskId: task.id, toWeek: nextWeek, label: task.title });
    runningTotal -= task.points;
  }

  return moves;
}

// ---- "Work on today" recommendation ----
export async function getTodaySuggestion(
  tasks: Task[],
  currentWeek: string,
  apiKey: string,
): Promise<string | null> {
  const todayTasks = tasks.filter(
    t => t.week === currentWeek && t.today && t.status !== 'done'
  );

  if (todayTasks.length === 0) return null;
  if (todayTasks.length === 1) return todayTasks[0].title;

  if (!apiKey) {
    const sorted = [...todayTasks].sort((a, b) => {
      const urgencyScore = (t: Task) =>
        t.metadata?.urgency === 'critical' ? 10 : t.metadata?.priority === 'high' ? 5 : 0;
      return (b.points + urgencyScore(b)) - (a.points + urgencyScore(a));
    });
    return sorted[0].title;
  }

  try {
    const taskList = todayTasks
      .map(t => `- "${t.title}" (${t.points} pts, priority: ${t.metadata?.priority || 'medium'}, urgency: ${t.metadata?.urgency || 'flexible'})`)
      .join('\n');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: `You are a focus advisor. Given today's tasks, pick the single most important one to start with. Consider urgency, priority, and effort size.\n\nTasks:\n${taskList}\n\nRespond with ONLY: {"title": "exact task title from the list above"}`
        }],
        temperature: 0.1,
      }),
    });

    if (!res.ok) return todayTasks[0].title;
    const data = await res.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    return parsed.title || todayTasks[0].title;
  } catch {
    return todayTasks[0].title;
  }
}

// ---- Autocomplete Auto-Fill Today Autopilot ----
export function autoFillToday(
  tasks: Task[],
  currentWeek: string,
  dailyLimit: number
): Task[] {
  const backlogThisWeek = tasks.filter(
    t => t.week === currentWeek && t.status !== 'done' && !t.today
  );

  const sortedBacklog = [...backlogThisWeek].sort((a, b) => {
    const getPrioVal = (t: Task) => t.metadata?.priority === 'high' ? 3 : t.metadata?.priority === 'medium' ? 2 : 1;
    const prioDiff = getPrioVal(b) - getPrioVal(a);
    if (prioDiff !== 0) return prioDiff;

    const getUrgencyVal = (t: Task) => t.metadata?.urgency === 'critical' ? 2 : 1;
    const urgencyDiff = getUrgencyVal(b) - getUrgencyVal(a);
    if (urgencyDiff !== 0) return urgencyDiff;

    return b.points - a.points; // larger tasks first
  });

  const todayTasks = tasks.filter(t => t.week === currentWeek && t.status !== 'done' && t.today);
  let currentTodayPoints = todayTasks.reduce((s, t) => s + t.points, 0);

  const updatedTasks = [...tasks];

  for (const task of sortedBacklog) {
    if (currentTodayPoints + task.points <= dailyLimit) {
      const idx = updatedTasks.findIndex(t => t.id === task.id);
      if (idx !== -1) {
        updatedTasks[idx] = { ...updatedTasks[idx], today: true };
        currentTodayPoints += task.points;
      }
    }
  }

  return updatedTasks;
}

// ---- Subtask Breakdown ----
export interface SubtaskSpec {
  title: string;
  points: 1 | 2 | 3 | 5 | 8;
  weekOffset: number; // relative to current week
}

export function shouldBreakDown(rawTitle: string, weekOffset: number): boolean {
  const lower = rawTitle.toLowerCase();
  if (weekOffset >= 2) return true;
  if (/\b(project|epic|launch|build|create|write|develop|design|research|report|plan|prepare|implement|migrate|overhaul|campaign|proposal|presentation|thesis|dissertation)\b/.test(lower)) return true;
  if (/\b(this month|next month|by end of|end of quarter|q[1-4]|semester|sprint)\b/.test(lower)) return true;
  return false;
}

function breakDownLocally(parentTitle: string, weekOffset: number): SubtaskSpec[] {
  const phases = [
    { suffix: '— research & plan', points: 1 as const, relativeWeek: 0 },
    { suffix: '— draft / build',   points: 3 as const, relativeWeek: Math.max(1, Math.floor(weekOffset / 2)) },
    { suffix: '— review & finish', points: 2 as const, relativeWeek: Math.max(weekOffset - 1, 1) },
  ];

  const shortName = parentTitle.length > 30 ? parentTitle.substring(0, 28) + '…' : parentTitle;

  return phases.map(p => ({
    title: `${shortName} ${p.suffix}`,
    points: p.points,
    weekOffset: p.relativeWeek,
  }));
}

export async function breakIntoSubtasks(
  parentTitle: string,
  weekOffset: number,
  currentWeek: string,
  apiKey: string,
): Promise<(SubtaskSpec & { week: string })[] | null> {
  const prompt = `You are a project planning assistant. A user has a goal that is ${weekOffset} week(s) away. 
Break it into 3–5 concrete, actionable subtasks spread across the available weeks, starting THIS week.

Rules:
1. First subtask = this week (weekOffset: 0) — something small like research/kickoff (1pt)
2. Middle subtask(s) = main work, spread across the middle weeks
3. Last subtask = review/polish/submit, 1 week before deadline (weekOffset: ${Math.max(weekOffset - 1, 1)})
4. Points: 1=quick(<30m), 2=minor(1-2h), 3=focus block, 5=full day
5. Each subtask title should be specific and actionable — NOT generic like "work on X"
6. Keep each title under 50 chars
7. Generate exactly 3–5 subtasks

Respond with ONLY valid JSON:
{
  "subtasks": [
    { "title": "...", "points": 1|2|3|5, "weekOffset": 0 }
  ]
}

Parent goal: "${parentTitle}"`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    const rawSubtasks = (parsed.subtasks || []) as Array<{ title?: string; points?: number; weekOffset?: number }>;
    const validPoints = [1, 2, 3, 5, 8];

    return rawSubtasks.slice(0, 5).map(s => {
      const offset = typeof s.weekOffset === 'number' ? Math.max(0, s.weekOffset) : 0;
      return {
        title: String(s.title || 'Subtask').substring(0, 60),
        points: (validPoints.includes(Number(s.points)) ? Number(s.points) : 2) as 1 | 2 | 3 | 5 | 8,
        weekOffset: offset,
        week: offset === 0 ? currentWeek : getOffsetWeekFromNow(offset),
      };
    });
  } catch {
    return null;
  }
}

export async function expandToSubtasks(
  parentTitle: string,
  weekOffset: number,
  currentWeek: string,
  apiKey: string,
): Promise<(SubtaskSpec & { week: string })[]> {
  if (apiKey) {
    const aiResult = await breakIntoSubtasks(parentTitle, weekOffset, currentWeek, apiKey);
    if (aiResult && aiResult.length > 0) return aiResult;
  }
  return breakDownLocally(parentTitle, weekOffset).map(s => ({
    ...s,
    week: s.weekOffset === 0 ? currentWeek : getOffsetWeekFromNow(s.weekOffset),
  }));
}
