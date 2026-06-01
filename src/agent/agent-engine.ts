import OpenAI from 'openai';
import type { Task, AppSettings, Weekday, Person, TaskMetadata } from '../types';

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: any[];
}

export interface AgentContext {
  tasks: Task[];
  people: Person[];
  pendingTask: { 
    title: string; 
    points: number; 
    today?: boolean; 
    week: string; 
    requestedBy?: string;
    metadata?: TaskMetadata;
  };
  settings: AppSettings;
  onPostponeTask: (taskId: string, targetWeek: string, targetDay: Weekday) => void;
  onDeleteTask: (taskId: string) => void;
  onUpdatePoints: (taskId: string, newPoints: 1 | 2 | 3 | 5 | 8) => void;
  onApproveAddition: () => void;
}

export function buildSystemPrompt(context: AgentContext): string {
  const currentWeekTasks = context.tasks.filter(t => t.week === context.pendingTask.week);
  const totalCurrentPoints = currentWeekTasks.reduce((sum, t) => sum + t.points, 0);
  const limit = context.settings.weeklyPointsLimit;

  // Compute active point breakdown per requester for the current week
  const pointsPerPerson: Record<string, number> = {};
  currentWeekTasks.forEach(t => {
    if (t.status !== 'done') {
      const name = t.requestedBy || 'Personal / Unassigned';
      pointsPerPerson[name] = (pointsPerPerson[name] || 0) + t.points;
    }
  });

  const activePointsBreakdown = Object.entries(pointsPerPerson).map(([name, pts]) => 
    `- **${name}**: ${pts} points scheduled this week`
  ).join('\n') || '- No active tasks scheduled.';

  // Compute completed history points per requester
  const completedPerPerson: Record<string, number> = {};
  context.tasks.forEach(t => {
    if (t.status === 'done') {
      const name = t.requestedBy || 'Personal / Unassigned';
      completedPerPerson[name] = (completedPerPerson[name] || 0) + t.points;
    }
  });

  const completedHistorySummary = Object.entries(completedPerPerson).map(([name, pts]) => 
    `- **${name}**: ${pts} points completed historically`
  ).join('\n') || '- No tasks completed yet.';

  // Format relationship profiles
  const peopleProfiles = context.people.map(p => 
    `- **${p.name}** (${p.relationship || 'No role'}): ${p.notes || 'No notes saved'}`
  ).join('\n') || '- No people registered in directory.';

  // Metadata Distribution calculations for the current week
  let highEnergyPoints = 0;
  let dreadedCount = 0;
  const domainBreakdown: Record<string, number> = {};

  currentWeekTasks.forEach(t => {
    if (t.status !== 'done') {
      if (t.metadata?.energyLevel === 'high') {
        highEnergyPoints += t.points;
      }
      if (t.metadata?.sentiment === 'dreaded') {
        dreadedCount += 1;
      }
      const dom = t.metadata?.domain || 'unclassified';
      domainBreakdown[dom] = (domainBreakdown[dom] || 0) + t.points;
    }
  });

  // Include pending task in calculations
  const pendingMeta = context.pendingTask.metadata;
  if (pendingMeta?.energyLevel === 'high') {
    highEnergyPoints += context.pendingTask.points;
  }
  if (pendingMeta?.sentiment === 'dreaded') {
    dreadedCount += 1;
  }
  const pendingDom = pendingMeta?.domain || 'unclassified';
  domainBreakdown[pendingDom] = (domainBreakdown[pendingDom] || 0) + context.pendingTask.points;

  const domainBreakdownMarkdown = Object.entries(domainBreakdown).map(([dom, pts]) => 
    `- **${dom}**: ${pts} points`
  ).join('\n');

  let taskListMarkdown = currentWeekTasks.map(t => {
    const meta = t.metadata;
    const metaStr = meta ? `[Energy: ${meta.energyLevel || '?'}, Domain: ${meta.domain || '?'}, Sentiment: ${meta.sentiment || '?'}, Urgency: ${meta.urgency || '?'}]` : '[No metadata]';
    return `- [ID: ${t.id}] "${t.title}" (${t.points} pts) - ${t.today ? 'Today' : 'Backlog'} [Assignee: ${t.requestedBy || 'Personal'}] ${metaStr}`;
  }).join('\n') || 'No tasks currently scheduled.';

  const pendingMetaStr = pendingMeta ? `[Energy: ${pendingMeta.energyLevel || '?'}, Domain: ${pendingMeta.domain || '?'}, Sentiment: ${pendingMeta.sentiment || '?'}, Urgency: ${pendingMeta.urgency || '?'}]` : '[No metadata]';

  return `You are the Focus Boundary Assistant, a thoughtful, objective capacity guardian.
Your purpose is to help the user fit their schedule within their velocity limit of ${limit} points.

We define points as focus effort:
- 1 point = Quick / Admin (<30 mins)
- 2 points = Minor task (1-2 hours)
- 3 points = Focus block (half day, 2-4 hours)
- 5 points = Substantial project (full day)
- 8 points = Complex epic (too big, should be split)

The user is trying to schedule:
- Title: "${context.pendingTask.title}"
- Points: ${context.pendingTask.points} points
- Time: ${context.pendingTask.today ? 'Today' : 'Backlog'}
- Week: ${context.pendingTask.week}
- For Person / Requested By: "${context.pendingTask.requestedBy || 'Personal / Unassigned'}"
- Task Metadata: ${pendingMetaStr}

**Current State of Week ${context.pendingTask.week}**:
- Scheduled points: ${totalCurrentPoints} / ${limit} points.
- Adding this task pushes the total to ${totalCurrentPoints + context.pendingTask.points} points, which exceeds the velocity limit of ${limit} points.

Here is the current task list for this week:
${taskListMarkdown}

---
### RECIPIENT & COMMITMENTS AUDIT
To help the user decide who to negotiate with, you must perform a Reciprocity Audit using this data:

**People Registry**:
${peopleProfiles}

**Active Load Per Person (This Week)**:
${activePointsBreakdown}

**Completed History Per Person (Reciprocity balance)**:
${completedHistorySummary}

---
### BURNOUT & VELOCITY METRICS AUDIT
- **High Energy Load**: ${highEnergyPoints} points (Target: Try to keep high-energy focus tasks under 10 points per week).
- **Dreaded Tasks Scheduled**: ${dreadedCount} (Warning: More than 2 dreaded tasks increases procrastination and fatigue dramatically).
- **Domain Balance**:
${domainBreakdownMarkdown}

Use this combined context to autonomously audit the week and propose specific shunts!
- Identify who is taking up the most capacity or who has had the most tasks completed recently (e.g. "Sarah is taking up 60% of your week, and you have already completed 15 points of work for her in the past.").
- Spot fatigue/burnout triggers. For example: "You have scheduled ${highEnergyPoints} points of high-energy tasks. This is too much focus load." or "You have ${dreadedCount} 'dreaded' tasks scheduled. Let's move some."
- Suggest concrete trade-offs, like: "Let's postpone the 5-point report for Sarah since she already got 12 points of your time recently, or reschedule 'X' to next week."
- Be supportive, but firm about protecting the user's velocity limit of ${limit} points.

---
Rules:
- You cannot approve the addition (do not call \`approve_addition\`) until the sum of active points in the week is less than or equal to the limit (${limit}).
- When a task is postponed, suggest moving it to another week (e.g., if this week is "2026-W22", suggest "2026-W23" or "2026-W24").
- Explain the adjustments clearly. Show a simple points balance statement before and after changes.
- Once the points are within the limit, call \`approve_addition\` immediately to save the new task and close the dialogue.
- Maintain a calm, supportive, professional, and helpful tone. Never use dramatic or flashing alert speech. Focus on protecting the user from burnout.`;
}

export const AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'postpone_task',
      description: 'Reschedule an existing task to another week and weekday.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The unique ID of the task to postpone' },
          targetWeek: { type: 'string', description: 'The target week in YYYY-Www format (e.g., 2026-W23)' },
          targetDay: { 
            type: 'string', 
            enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            description: 'The target weekday' 
          },
        },
        required: ['taskId', 'targetWeek', 'targetDay'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_task',
      description: 'Remove a task from the schedule entirely.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The unique ID of the task to delete' },
        },
        required: ['taskId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_task_points',
      description: 'Resize the story points of a task (either an existing task, or the new task).',
      parameters: {
        type: 'object',
        properties: {
          taskId: { 
            type: 'string', 
            description: 'The task ID. Pass "new_task" to resize the task currently being added.' 
          },
          newPoints: { 
            type: 'number', 
            enum: [1, 2, 3, 5, 8],
            description: 'The new story point size' 
          },
        },
        required: ['taskId', 'newPoints'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'approve_addition',
      description: 'Approve the addition of the new task once points are within the velocity limit.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

export async function runAgentStep(
  openaiKey: string,
  messages: AgentMessage[],
  context: AgentContext
): Promise<{ messages: AgentMessage[]; approved: boolean }> {
  // Initialize standard openai client client-side
  const openai = new OpenAI({
    apiKey: openaiKey,
    dangerouslyAllowBrowser: true,
  });

  const model = 'gpt-4o-mini'; // Mapped under the hood for GPT 5.4-NANO
  const sysPromptContent = buildSystemPrompt(context);

  // Prepare full message sequence
  const apiMessages = [
    { role: 'system' as const, content: sysPromptContent },
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'tool',
      content: m.content,
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.name ? { name: m.name } : {}),
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    })),
  ] as any[];

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: apiMessages,
      tools: AGENT_TOOLS,
      tool_choice: 'auto',
    });

    const assistantMessage = completion.choices[0].message;
    const newMessages: AgentMessage[] = [...messages];

    let approved = false;

    // Convert tool calls to internal schema
    const toolCalls = assistantMessage.tool_calls;
    newMessages.push({
      role: 'assistant',
      content: assistantMessage.content,
      tool_calls: toolCalls,
    });

    if (toolCalls && toolCalls.length > 0) {
      for (const call of toolCalls) {
        const name = (call as any).function.name;
        const args = JSON.parse((call as any).function.arguments);
        let result = '';

        try {
          if (name === 'postpone_task') {
            context.onPostponeTask(args.taskId, args.targetWeek, args.targetDay as Weekday);
            result = `Success: Postponed task ${args.taskId} to ${args.targetWeek} (${args.targetDay})`;
          } else if (name === 'delete_task') {
            context.onDeleteTask(args.taskId);
            result = `Success: Deleted task ${args.taskId}`;
          } else if (name === 'update_task_points') {
            if (args.taskId === 'new_task') {
              // Modify context pending points
              context.onUpdatePoints('new_task', args.newPoints as 1 | 2 | 3 | 5 | 8);
              result = `Success: Resized the new task to ${args.newPoints} points`;
            } else {
              context.onUpdatePoints(args.taskId, args.newPoints as 1 | 2 | 3 | 5 | 8);
              result = `Success: Resized task ${args.taskId} to ${args.newPoints} points`;
            }
          } else if (name === 'approve_addition') {
            // Confirm capacity check
            const currentWeekTasks = context.tasks.filter(t => t.week === context.pendingTask.week);
            const currentPoints = currentWeekTasks.reduce((sum, t) => sum + t.points, 0);
            const limit = context.settings.weeklyPointsLimit;

            if (currentPoints + context.pendingTask.points <= limit) {
              context.onApproveAddition();
              result = `Success: Addition approved. points are currently ${currentPoints + context.pendingTask.points}/${limit}`;
              approved = true;
            } else {
              result = `Error: Cannot approve addition. Current points (${currentPoints}) + new task points (${context.pendingTask.points}) equals ${currentPoints + context.pendingTask.points}, which still exceeds limit ${limit}. Please reschedule or resize more tasks first.`;
            }
          }
        } catch (e: any) {
          result = `Error executing tool ${name}: ${e.message}`;
        }

        newMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: name,
          content: result,
        });
      }

      // Recursively run the next step to let the model react to tool outputs
      const nextRun = await runAgentStep(openaiKey, newMessages, context);
      return nextRun;
    }

    return { messages: newMessages, approved };
  } catch (err: any) {
    console.error('Agent execution error:', err);
    throw err;
  }
}
