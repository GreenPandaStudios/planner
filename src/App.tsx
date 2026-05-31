import { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  Settings as SettingsIcon, 
  Trash2, 
  AlertTriangle, 
  Send, 
  X, 
  Key, 
  Brain,
  Download,
  Upload,
  Globe,
  User
} from 'lucide-react';
import type { Task, AppSettings, Weekday, AgentChatMessage, Person, TaskMetadata } from './types';
import { WEEKDAYS } from './types';
import { 
  findExistingGist, 
  createPrivateGist, 
  fetchTasksFromGist, 
  saveTasksToGist 
} from './utils/github-sync';
import { runAgentStep } from './agent/agent-engine';
import type { AgentMessage, AgentContext } from './agent/agent-engine';
import './App.css';

// --- Week Helper Utilities ---
function getIsoWeek(date: Date): string {
  const tempDate = new Date(date.valueOf());
  tempDate.setDate(tempDate.getDate() + 4 - (tempDate.getDay() || 7));
  const yearStart = new Date(tempDate.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((tempDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${tempDate.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getMondayOfIsoWeek(weekStr: string): Date {
  const [year, week] = weekStr.split('-W');
  const y = parseInt(year);
  const w = parseInt(week);
  const simple = new Date(y, 0, 1 + (w - 1) * 7);
  const dow = simple.getDay();
  const ISOweekStart = simple;
  if (dow <= 4) {
    ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
  } else {
    ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
  }
  return ISOweekStart;
}

function formatWeekRange(weekStr: string): string {
  const mon = getMondayOfIsoWeek(weekStr);
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const monStr = mon.toLocaleDateString('en-US', options);
  
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  const friStr = fri.toLocaleDateString('en-US', { ...options, year: 'numeric' });
  
  return `${monStr} – ${friStr}`;
}

function getOffsetWeek(weekStr: string, offsetWeeks: number): string {
  const mon = getMondayOfIsoWeek(weekStr);
  mon.setDate(mon.getDate() + (offsetWeeks * 7));
  return getIsoWeek(mon);
}

// --- Metadata Helpers ---
const parseTaskMetadataLocally = (title: string, description?: string): TaskMetadata => {
  const combined = `${title} ${description || ''}`.toLowerCase();
  
  // 1. Energy level
  let energyLevel: 'high' | 'medium' | 'low' = 'medium';
  if (/\b(write|code|build|design|debug|study|learn|plan|create|report|presentation|strategy|pitch|review|test|refactor)\b/.test(combined)) {
    energyLevel = 'high';
  } else if (/\b(email|admin|clean|organize|file|call|chat|check|update|fix|meeting|schedule|log|post|tweet|buy|order|coffee|tea|lunch)\b/.test(combined)) {
    energyLevel = 'low';
  }

  // 2. Domain
  let domain: 'work' | 'personal' | 'health' | 'other' = 'work';
  if (/\b(gym|run|meditate|workout|sleep|health|doctor|dentist|therapy|walk|exercise|eat|grocery|food|water)\b/.test(combined)) {
    domain = 'health';
  } else if (/\b(personal|home|family|kid|child|wife|husband|mom|dad|friend|house|apartment|rent|cleaning|laundry|chore|hobby|read|game|movie|tv|shopping)\b/.test(combined)) {
    domain = 'personal';
  }

  // 3. Sentiment
  let sentiment: 'neutral' | 'dreaded' | 'excited' | 'routine' = 'neutral';
  if (/\b(dread|hate|annoy|boring|hard|difficult|tedious|pain|ugh|suck|awful|unpleasant|chore)\b/.test(combined)) {
    sentiment = 'dreaded';
  } else if (/\b(excited|happy|fun|love|glad|awesome|cool|interest|learn|creative|enjoy)\b/.test(combined)) {
    sentiment = 'excited';
  } else if (/\b(daily|weekly|monthly|routine|habit|standard|check-in|retro|sync)\b/.test(combined)) {
    sentiment = 'routine';
  }

  // 4. Urgency
  let urgency: 'critical' | 'flexible' = 'flexible';
  if (/\b(urgent|asap|critical|must|important|deadline|due|today|tomorrow|fast|now|immediate)\b/.test(combined)) {
    urgency = 'critical';
  }

  let deadline: string | undefined = undefined;
  const deadlineMatch = combined.match(/\b(?:by|due|on)\s+([a-zA-Z0-9]+)\b/);
  if (deadlineMatch && deadlineMatch[1]) {
    deadline = deadlineMatch[1];
  }

  // 5. Priority
  let priority: 'high' | 'medium' | 'low' = 'medium';
  if (urgency === 'critical' || /\b(high priority|p0|p1|urgent)\b/.test(combined)) {
    priority = 'high';
  } else if (/\b(low priority|p3|p4|backlog|whenever|someday)\b/.test(combined)) {
    priority = 'low';
  }

  return {
    energyLevel,
    domain,
    sentiment,
    urgency,
    deadline,
    priority,
    aiEnriched: false
  };
};

const enrichTaskWithAI = async (task: Task, apiKey: string): Promise<TaskMetadata> => {
  if (!apiKey) {
    return parseTaskMetadataLocally(task.title, task.description);
  }
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an AI metadata assistant. Given a task title and description, you must classify it into a structured JSON metadata format.
Your output must be a single JSON object with EXACTLY this structure:
{
  "energyLevel": "high" | "medium" | "low",
  "domain": "work" | "personal" | "health" | "other",
  "sentiment": "neutral" | "dreaded" | "excited" | "routine",
  "urgency": "critical" | "flexible",
  "deadline": string or null,
  "priority": "high" | "medium" | "low"
}

Classification Guide:
1. energyLevel: 
   - "high": deep focus, complex problem solving, writing, designing, coding, planning.
   - "low": simple admin, emails, quick checkins, chores, filing, data entry.
   - "medium": standard tasks in between.
2. domain:
   - "work": professional/business commitments, job, clients.
   - "personal": hobbies, house chores, household, family.
   - "health": fitness, doctors, sleep, mental health, exercise.
   - "other": anything else.
3. sentiment:
   - "dreaded": tasks the user explicitly avoids, finds boring, annoying, or difficult.
   - "excited": tasks the user is looking forward to, creative, learning.
   - "routine": recurring, habits, administrative.
   - "neutral": default.
4. urgency: "critical" if it must be done by a specific deadline or has high consequence, otherwise "flexible".
5. deadline: extract any mentioned date or day if any, else null.
6. priority: based on context of importance.`
          },
          {
            role: 'user',
            content: `Task Title: "${task.title}"\nDescription: "${task.description || ''}"`
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API responded with status ${response.status}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);
    return {
      energyLevel: result.energyLevel || 'medium',
      domain: result.domain || 'work',
      sentiment: result.sentiment || 'neutral',
      urgency: result.urgency || 'flexible',
      deadline: result.deadline || undefined,
      priority: result.priority || 'medium',
      aiEnriched: true
    };
  } catch (e) {
    console.error('Error in enrichTaskWithAI:', e);
    return parseTaskMetadataLocally(task.title, task.description);
  }
};

// --- Initial States ---
const DEFAULT_SETTINGS: AppSettings = {
  openaiApiKey: '',
  githubPat: '',
  gistId: '',
  weeklyPointsLimit: 30
};

export default function App() {
  // --- Core States ---
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [currentWeek, setCurrentWeek] = useState<string>('');
  
  // --- UI States ---
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isNegotiating, setIsNegotiating] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    const saved = localStorage.getItem('antigravity_planner_show_onboarding');
    return saved !== null ? JSON.parse(saved) : true;
  });

  const toggleOnboarding = () => {
    setShowOnboarding(prev => {
      const next = !prev;
      localStorage.setItem('antigravity_planner_show_onboarding', JSON.stringify(next));
      return next;
    });
  };

  // --- Task Form States ---
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskPoints, setTaskPoints] = useState<1 | 2 | 3 | 5 | 8>(1);
  const [taskDay, setTaskDay] = useState<Weekday>('Monday');
  const [taskRequestedBy, setTaskRequestedBy] = useState('');
  const [quickTaskTitle, setQuickTaskTitle] = useState('');

  // --- Pending Task State (when capacity exceeded) ---
  const [pendingTaskAction, setPendingTaskAction] = useState<{
    type: 'add' | 'edit';
    task: Task;
  } | null>(null);

  // --- Agent Chat States ---
  const [agentMessages, setAgentMessages] = useState<AgentChatMessage[]>([]);
  const [agentRawHistory, setAgentRawHistory] = useState<AgentMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isAgentTyping, setIsAgentTyping] = useState(false);
  const [deletedTaskBackup, setDeletedTaskBackup] = useState<Task | null>(null);
  const [showUndoToast, setShowUndoToast] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // Native dialog refs
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  const taskDialogRef = useRef<HTMLDialogElement>(null);
  const negotiatorDialogRef = useRef<HTMLDialogElement>(null);
  const quickCaptureInputRef = useRef<HTMLInputElement>(null);

  // --- Initialization ---
  useEffect(() => {
    setCurrentWeek(getIsoWeek(new Date()));

    const savedSettings = localStorage.getItem('antigravity_planner_settings');
    if (savedSettings) {
      try { setSettings(JSON.parse(savedSettings)); } catch (e) { console.error('Error loading settings', e); }
    }

    const savedTasks = localStorage.getItem('antigravity_planner_tasks');
    if (savedTasks) {
      try { setTasks(JSON.parse(savedTasks)); } catch (e) { console.error('Error loading tasks', e); }
    }

    const savedPeople = localStorage.getItem('antigravity_planner_people');
    if (savedPeople) {
      try { setPeople(JSON.parse(savedPeople)); } catch (e) { console.error('Error loading people', e); }
    }
  }, []);

  // --- Dialog controls ---
  useEffect(() => {
    if (isSettingsOpen) settingsDialogRef.current?.showModal();
    else settingsDialogRef.current?.close();
  }, [isSettingsOpen]);

  useEffect(() => {
    if (isTaskModalOpen) taskDialogRef.current?.showModal();
    else taskDialogRef.current?.close();
  }, [isTaskModalOpen]);

  useEffect(() => {
    if (isNegotiating) {
      negotiatorDialogRef.current?.showModal();
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      negotiatorDialogRef.current?.close();
    }
  }, [isNegotiating]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentMessages, isAgentTyping]);

  useEffect(() => {
    if (showUndoToast) {
      const timer = setTimeout(() => {
        setShowUndoToast(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [showUndoToast]);

  // --- Sync Triggers ---
  useEffect(() => {
    if (settings.githubPat) {
      triggerGistSyncPull();
    }
  }, [settings.githubPat, settings.gistId]);

  // --- Online Auto-Sync ---
  useEffect(() => {
    const handleOnline = () => {
      console.log('Network returned online. Re-syncing database...');
      if (settings.githubPat) {
        triggerGistSyncPull();
      }
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [settings.githubPat, settings.gistId]);

  const saveTasksState = (newTasks: Task[], shouldSyncPush = true) => {
    setTasks(newTasks);
    localStorage.setItem('antigravity_planner_tasks', JSON.stringify(newTasks));
    if (shouldSyncPush && settings.githubPat && settings.gistId) {
      triggerGistSyncPush(newTasks, people);
    }
  };

  const savePeopleState = (newPeople: Person[], shouldSyncPush = true) => {
    setPeople(newPeople);
    localStorage.setItem('antigravity_planner_people', JSON.stringify(newPeople));
    if (shouldSyncPush && settings.githubPat && settings.gistId) {
      triggerGistSyncPush(tasks, newPeople);
    }
  };

  const triggerGistSyncPull = async () => {
    if (!settings.githubPat) return;
    setSyncStatus('syncing');
    try {
      let activeGistId = settings.gistId;
      if (!activeGistId) {
        const foundId = await findExistingGist(settings.githubPat);
        if (foundId) {
          activeGistId = foundId;
          const updatedSettings = { ...settings, gistId: foundId };
          setSettings(updatedSettings);
          localStorage.setItem('antigravity_planner_settings', JSON.stringify(updatedSettings));
        } else {
          const newId = await createPrivateGist(settings.githubPat, tasks, people);
          activeGistId = newId;
          const updatedSettings = { ...settings, gistId: newId };
          setSettings(updatedSettings);
          localStorage.setItem('antigravity_planner_settings', JSON.stringify(updatedSettings));
        }
      }

      if (activeGistId) {
        const fetched = await fetchTasksFromGist(settings.githubPat, activeGistId);
        if (fetched) {
          setTasks(fetched.tasks);
          setPeople(fetched.people);
          localStorage.setItem('antigravity_planner_tasks', JSON.stringify(fetched.tasks));
          localStorage.setItem('antigravity_planner_people', JSON.stringify(fetched.people));
        }
        setSyncStatus('synced');
      }
    } catch (e: any) {
      setSyncStatus('error');
    }
  };

  const triggerGistSyncPush = async (tasksToPush: Task[], peopleToPush: Person[]) => {
    if (!settings.githubPat || !settings.gistId) return;
    setSyncStatus('syncing');
    try {
      await saveTasksToGist(settings.githubPat, settings.gistId, tasksToPush, peopleToPush);
      setSyncStatus('synced');
    } catch (e: any) {
      setSyncStatus('error');
    }
  };

  // --- Point & Load Computations ---
  const getWeekPoints = (weekStr: string, taskList: Task[] = tasks) => {
    return taskList
      .filter(t => t.week === weekStr && t.status !== 'done')
      .reduce((sum, t) => sum + t.points, 0);
  };

  const getDayPoints = (weekStr: string, day: Weekday, taskList: Task[] = tasks) => {
    return taskList
      .filter(t => t.week === weekStr && t.day === day && t.status !== 'done')
      .reduce((sum, t) => sum + t.points, 0);
  };

  // Triage state calculations

  // --- Task Save & Validation ---
  const openAddTask = (day: Weekday) => {
    setQuickTaskTitle(` ${day}`);
    setTimeout(() => {
      quickCaptureInputRef.current?.focus();
      if (quickCaptureInputRef.current) {
        quickCaptureInputRef.current.setSelectionRange(0, 0);
      }
    }, 50);
  };

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setTaskTitle(task.title);
    setTaskDesc(task.description || '');
    setTaskPoints(task.points);
    setTaskDay(task.day);
    setTaskRequestedBy(task.requestedBy || '');
    setIsTaskModalOpen(true);
  };

  const handleTitleChange = (val: string) => {
    setTaskTitle(val);
    // Real-time title parsing: match 'for Sarah', 'asks Alex', etc.
    const match = val.match(/(?:for|to|with|asks?)\s+([A-Z][a-zA-Z]*)/);
    if (match && match[1]) {
      setTaskRequestedBy(match[1]);
    }
  };

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTaskTitle.trim()) return;

    // Parse the input locally using our heuristic parser
    const parsedMeta = parseTaskMetadataLocally(quickTaskTitle);
    
    // Check if weekday was parsed from title (e.g., matching "Monday", "Tuesday", etc.)
    const titleLower = quickTaskTitle.toLowerCase();
    let assignedDay: Weekday = 'Monday'; // Default
    for (const d of WEEKDAYS) {
      if (titleLower.includes(d.toLowerCase())) {
        assignedDay = d;
        break;
      }
    }
    
    // Check if points were parsed from title (e.g. "3 pts", "5pt", "points 8", or trailing numbers)
    let assignedPoints: 1 | 2 | 3 | 5 | 8 = 1; // Default
    const pointsMatch = quickTaskTitle.match(/\b(1|2|3|5|8)\s*(?:pts?|points?|pt)?\b/i);
    if (pointsMatch && pointsMatch[1]) {
      assignedPoints = parseInt(pointsMatch[1]) as 1 | 2 | 3 | 5 | 8;
    }

    // Check if requester was parsed
    const requesterMatch = quickTaskTitle.match(/(?:for|to|with|asks?)\s+([A-Z][a-zA-Z]*)/);
    const assignedRequester = requesterMatch && requesterMatch[1] ? requesterMatch[1] : undefined;

    // Remove parsed metadata noise from the title to keep it clean!
    let cleanedTitle = quickTaskTitle;
    
    // Remove the weekday name from title
    for (const d of WEEKDAYS) {
      const reg = new RegExp(`\\b${d}\\b`, 'i');
      cleanedTitle = cleanedTitle.replace(reg, '');
    }
    // Remove the points pattern (e.g., "3 pts", "3pts", "3 pt")
    cleanedTitle = cleanedTitle.replace(/\b(?:1|2|3|5|8)\s*(?:pts?|points?|pt)?\b/i, '');
    
    // Remove "for/to/with Name" patterns
    cleanedTitle = cleanedTitle.replace(/(?:for|to|with|asks?)\s+[A-Z][a-zA-Z]*/g, '');
    
    // Clean up whitespace
    cleanedTitle = cleanedTitle.trim().replace(/\s+/g, ' ');
    if (!cleanedTitle) {
      cleanedTitle = quickTaskTitle; // Fallback if we stripped everything
    }

    // Capitalize first letter of cleaned title
    cleanedTitle = cleanedTitle.charAt(0).toUpperCase() + cleanedTitle.slice(1);

    const newQuickTask: Task = {
      id: Math.random().toString(36).substring(2, 9),
      title: cleanedTitle,
      points: assignedPoints,
      week: currentWeek,
      day: assignedDay,
      status: 'todo',
      createdAt: Date.now(),
      requestedBy: assignedRequester,
      metadata: parsedMeta
    };

    // Check if requester exists in registry, if not, add them
    let nextPeople = people;
    if (assignedRequester) {
      const personExists = people.some(p => p.name.toLowerCase() === assignedRequester.toLowerCase());
      if (!personExists) {
        const newPerson: Person = {
          id: Math.random().toString(36).substring(2, 9),
          name: assignedRequester,
          createdAt: Date.now()
        };
        nextPeople = [...people, newPerson];
        setPeople(nextPeople);
        localStorage.setItem('antigravity_planner_people', JSON.stringify(nextPeople));
      }
    }

    // Save directly (we allow overloading, visual warning tells user to triage with AI)
    const updatedTasks = [...tasks, newQuickTask];
    setTasks(updatedTasks);
    localStorage.setItem('antigravity_planner_tasks', JSON.stringify(updatedTasks));
    setQuickTaskTitle('');

    if (settings.openaiApiKey) {
      enrichTaskWithAI(newQuickTask, settings.openaiApiKey).then(enrichedMeta => {
        setTasks(current => {
          const next = current.map(t => t.id === newQuickTask.id ? { ...t, metadata: enrichedMeta } : t);
          localStorage.setItem('antigravity_planner_tasks', JSON.stringify(next));
          if (settings.githubPat && settings.gistId) {
            triggerGistSyncPush(next, nextPeople);
          }
          return next;
        });
      });
    } else {
      if (settings.githubPat && settings.gistId) {
        triggerGistSyncPush(updatedTasks, nextPeople);
      }
    }
  };

  const handleTriggerManualTriage = () => {
    const currentWeekTasks = tasks.filter(t => t.week === currentWeek && t.status !== 'done');
    if (currentWeekTasks.length === 0) return;
    
    // Sort by newest
    const sorted = [...currentWeekTasks].sort((a, b) => b.createdAt - a.createdAt);
    const targetTask = sorted[0];

    const restTasks = tasks.filter(t => t.id !== targetTask.id);

    setPendingTaskAction({
      type: 'edit',
      task: targetTask
    });

    initiateNegotiation(targetTask, restTasks);
  };

  const handleSaveTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;

    const cleanedName = taskRequestedBy.trim();

    const hasTextChanged = 
      !editingTask || 
      editingTask.title !== taskTitle || 
      editingTask.description !== taskDesc;

    const localMeta = hasTextChanged 
      ? parseTaskMetadataLocally(taskTitle, taskDesc) 
      : (editingTask.metadata || parseTaskMetadataLocally(taskTitle, taskDesc));

    const proposedTask: Task = {
      id: editingTask?.id || Math.random().toString(36).substring(2, 9),
      title: taskTitle,
      description: taskDesc,
      points: taskPoints,
      week: editingTask?.week || currentWeek,
      day: taskDay,
      status: (editingTask?.status || 'todo') as 'todo' | 'in-progress' | 'done',
      createdAt: editingTask?.createdAt || Date.now(),
      requestedBy: cleanedName || undefined,
      metadata: localMeta,
    };

    const currentPointsExcludeTarget = tasks
      .filter(t => t.week === proposedTask.week && t.status !== 'done' && t.id !== proposedTask.id)
      .reduce((sum, t) => sum + t.points, 0);

    const totalProposedPoints = currentPointsExcludeTarget + proposedTask.points;

    // Check if requester exists, if not register them
    let nextPeople = people;
    if (cleanedName) {
      const personExists = people.some(p => p.name.toLowerCase() === cleanedName.toLowerCase());
      if (!personExists) {
        const newPerson: Person = {
          id: Math.random().toString(36).substring(2, 9),
          name: cleanedName,
          createdAt: Date.now()
        };
        nextPeople = [...people, newPerson];
      }
    }

    if (totalProposedPoints > settings.weeklyPointsLimit) {
      if (!settings.openaiApiKey) {
        alert(`Adding this task would push you to ${totalProposedPoints} points, exceeding your limit of ${settings.weeklyPointsLimit}.\n\nPlease set your OpenAI API key in Settings to use the Capacity Assistant.`);
        return;
      }
      
      // Auto-save the new person profile locally first so agent knows them
      if (nextPeople !== people) {
        savePeopleState(nextPeople, false);
      }

      setIsTaskModalOpen(false);
      setPendingTaskAction({
        type: editingTask ? 'edit' : 'add',
        task: proposedTask,
      });
      initiateNegotiation(proposedTask, tasks, nextPeople);

      // Async background AI enrichment to overwrite local heuristic for better negotiation quality
      enrichTaskWithAI(proposedTask, settings.openaiApiKey).then(enrichedMeta => {
        setPendingTaskAction(prev => {
          if (!prev) return null;
          return { ...prev, task: { ...prev.task, metadata: enrichedMeta } };
        });
      });
    } else {
      // Save directly
      if (nextPeople !== people) {
        setPeople(nextPeople);
        localStorage.setItem('antigravity_planner_people', JSON.stringify(nextPeople));
      }
      let updatedTasks: Task[];
      if (editingTask) {
        updatedTasks = tasks.map(t => t.id === proposedTask.id ? proposedTask : t);
      } else {
        updatedTasks = [...tasks, proposedTask];
      }
      // Pushes both tasks and people to Gist
      setTasks(updatedTasks);
      localStorage.setItem('antigravity_planner_tasks', JSON.stringify(updatedTasks));
      setIsTaskModalOpen(false);

      if (settings.openaiApiKey) {
        enrichTaskWithAI(proposedTask, settings.openaiApiKey).then(enrichedMeta => {
          setTasks(currentTasks => {
            const nextTasks = currentTasks.map(t => 
              t.id === proposedTask.id ? { ...t, metadata: enrichedMeta } : t
            );
            localStorage.setItem('antigravity_planner_tasks', JSON.stringify(nextTasks));
            if (settings.githubPat && settings.gistId) {
              triggerGistSyncPush(nextTasks, nextPeople);
            }
            return nextTasks;
          });
        });
      } else {
        if (settings.githubPat && settings.gistId) {
          triggerGistSyncPush(updatedTasks, nextPeople);
        }
      }
    }
  };

  const handleDeleteTask = (taskId: string) => {
    const targetTask = tasks.find(t => t.id === taskId);
    if (!targetTask) return;
    setDeletedTaskBackup(targetTask);
    setShowUndoToast(true);

    const updated = tasks.filter(t => t.id !== taskId);
    saveTasksState(updated);
  };

  const handleUndoDelete = () => {
    if (!deletedTaskBackup) return;
    const updated = [...tasks, deletedTaskBackup];
    saveTasksState(updated);
    setDeletedTaskBackup(null);
    setShowUndoToast(false);
  };

  const handleCyclePoints = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    const pointsOrder: (1 | 2 | 3 | 5 | 8)[] = [1, 2, 3, 5, 8];
    const currentIndex = pointsOrder.indexOf(task.points);
    const nextPoints = pointsOrder[(currentIndex + 1) % pointsOrder.length];
    
    const updated = tasks.map(t => t.id === task.id ? { ...t, points: nextPoints } : t);
    saveTasksState(updated);
  };

  const handleMoveDay = (task: Task, targetDay: Weekday, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = tasks.map(t => t.id === task.id ? { ...t, day: targetDay } : t);
    saveTasksState(updated);
  };

  const toggleTaskStatus = (task: Task) => {
    const updated = tasks.map(t => {
      if (t.id === task.id) {
        const nextStatus: 'todo' | 'done' = t.status === 'done' ? 'todo' : 'done';
        return { 
          ...t, 
          status: nextStatus,
          completedAt: nextStatus === 'done' ? Date.now() : undefined
        };
      }
      return t;
    });
    saveTasksState(updated);
  };

  // --- Settings Actions ---
  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('antigravity_planner_settings', JSON.stringify(settings));
    setIsSettingsOpen(false);
  };

  // --- Negotiation Agent Orchestration ---
  const initiateNegotiation = (pending: Task, currentTasks: Task[], _peopleList?: Person[]) => {
    const welcomeMsg = `### Capacity Limit Met
Adding **"${pending.title}"** sized at **${pending.points} point(s)** ${pending.requestedBy ? `for **${pending.requestedBy}**` : ''} will push your active weekly load to **${getWeekPoints(pending.week, currentTasks) + pending.points} points**, which exceeds your set limit of **${settings.weeklyPointsLimit} points**.

I have paused the save to protect your focus. Let's review your schedule. I will audit who is asking for your time this week and help you find a compromise.`;

    setAgentMessages([
      {
        id: 'welcome',
        sender: 'agent',
        text: welcomeMsg,
        timestamp: Date.now(),
      }
    ]);
    
    setAgentRawHistory([
      {
        role: 'assistant',
        content: welcomeMsg
      }
    ]);
    
    setIsNegotiating(true);
  };

  const handleSendAgentMessage = async () => {
    if (!chatInput.trim() || !pendingTaskAction || !settings.openaiApiKey) return;

    const userText = chatInput;
    setChatInput('');

    const newUserMsg: AgentChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      sender: 'user',
      text: userText,
      timestamp: Date.now(),
    };
    setAgentMessages(prev => [...prev, newUserMsg]);

    const nextRawHistory: AgentMessage[] = [
      ...agentRawHistory,
      {
        role: 'user',
        content: userText
      }
    ];
    setAgentRawHistory(nextRawHistory);
    setIsAgentTyping(true);

    const context: AgentContext = {
      tasks: tasks,
      people: people,
      pendingTask: {
        title: pendingTaskAction.task.title,
        points: pendingTaskAction.task.points,
        day: pendingTaskAction.task.day,
        week: pendingTaskAction.task.week,
        requestedBy: pendingTaskAction.task.requestedBy,
        metadata: pendingTaskAction.task.metadata
      },
      settings: settings,
      onPostponeTask: (taskId, targetWeek, targetDay) => {
        setAgentMessages(prev => [...prev, {
          id: Math.random().toString(36).substring(2, 9),
          sender: 'agent',
          text: `⚙️ *Tool execution: Rescheduling task [ID: ${taskId}] to ${targetWeek} (${targetDay})*`,
          timestamp: Date.now()
        }]);

        setTasks(prev => prev.map(t => {
          if (t.id === taskId) return { ...t, week: targetWeek, day: targetDay };
          return t;
        }));
      },
      onDeleteTask: (taskId) => {
        setAgentMessages(prev => [...prev, {
          id: Math.random().toString(36).substring(2, 9),
          sender: 'agent',
          text: `⚙️ *Tool execution: Deleting task [ID: ${taskId}]*`,
          timestamp: Date.now()
        }]);
        setTasks(prev => prev.filter(t => t.id !== taskId));
      },
      onUpdatePoints: (taskId, newPoints) => {
        if (taskId === 'new_task') {
          setAgentMessages(prev => [...prev, {
            id: Math.random().toString(36).substring(2, 9),
            sender: 'agent',
            text: `⚙️ *Tool execution: Resizing pending task size to ${newPoints} points*`,
            timestamp: Date.now()
          }]);
          setPendingTaskAction(prev => {
            if (!prev) return null;
            return { ...prev, task: { ...prev.task, points: newPoints } };
          });
        } else {
          setAgentMessages(prev => [...prev, {
            id: Math.random().toString(36).substring(2, 9),
            sender: 'agent',
            text: `⚙️ *Tool execution: Resizing task [ID: ${taskId}] to ${newPoints} points*`,
            timestamp: Date.now()
          }]);
          setTasks(prev => prev.map(t => {
            if (t.id === taskId) return { ...t, points: newPoints };
            return t;
          }));
        }
      },
      onApproveAddition: () => {}
    };

    try {
      const response = await runAgentStep(settings.openaiApiKey, nextRawHistory, context);
      setAgentRawHistory(response.messages);

      const assistantTextMsg = response.messages[response.messages.length - 1];
      if (assistantTextMsg && assistantTextMsg.content) {
        setAgentMessages(prev => [...prev, {
          id: Math.random().toString(36).substring(2, 9),
          sender: 'agent',
          text: assistantTextMsg.content || '',
          timestamp: Date.now()
        }]);
      }

      if (response.approved) {
        setTasks(current => {
          let updatedList = current;
          if (pendingTaskAction.type === 'edit') {
            updatedList = current.map(t => t.id === pendingTaskAction.task.id ? pendingTaskAction.task : t);
          } else {
            updatedList = [...current, pendingTaskAction.task];
          }
          saveTasksState(updatedList);
          return updatedList;
        });

        setTimeout(() => {
          alert('Capacity Audit complete! The transaction has been saved.');
          setIsNegotiating(false);
          setPendingTaskAction(null);
        }, 500);
      }
    } catch (err: any) {
      setAgentMessages(prev => [...prev, {
        id: Math.random().toString(36).substring(2, 9),
        sender: 'agent',
        text: `⚠️ **Agent Error**: ${err.message || 'An error occurred during negotiation.'}`,
        timestamp: Date.now()
      }]);
    } finally {
      setIsAgentTyping(false);
    }
  };

  const handleCancelNegotiation = () => {
    const savedTasks = localStorage.getItem('antigravity_planner_tasks');
    if (savedTasks) setTasks(JSON.parse(savedTasks));
    setIsNegotiating(false);
    setPendingTaskAction(null);
  };

  const triggerManualNegotiation = () => {
    if (!settings.openaiApiKey) {
      alert('Please set your OpenAI API key in Settings first to speak with the Capacity Assistant.');
      return;
    }
    
    const mockPending: Task = {
      id: 'audit_session',
      title: 'Current Week Capacity Review',
      points: 1,
      week: currentWeek,
      day: 'Monday',
      status: 'todo',
      createdAt: Date.now()
    };

    setPendingTaskAction({
      type: 'add',
      task: mockPending
    });

    const welcomeMsg = `### Capacity Review Session
I am your capacity advisor. You requested a review of your scheduled load for the week of **${formatWeekRange(currentWeek)}**.

Currently, you have **${getWeekPoints(currentWeek)} / ${settings.weeklyPointsLimit} points** scheduled. If you are feeling overwhelmed, tell me what is stressing you out. I can audit your commitments to see where we can trim down.`;

    setAgentMessages([
      {
        id: 'manual_welcome',
        sender: 'agent',
        text: welcomeMsg,
        timestamp: Date.now(),
      }
    ]);
    
    setAgentRawHistory([
      {
        role: 'assistant',
        content: welcomeMsg
      }
    ]);
    
    setIsNegotiating(true);
  };



  // --- Export / Import Backup ---
  const handleExportJSON = () => {
    const backupData = { tasks, people };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `planner-backup-${currentWeek}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], "UTF-8");
      fileReader.onload = event => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          if (parsed && Array.isArray(parsed.tasks) && Array.isArray(parsed.people)) {
            setPeople(parsed.people);
            localStorage.setItem('antigravity_planner_people', JSON.stringify(parsed.people));
            saveTasksState(parsed.tasks, false);
            if (settings.githubPat && settings.gistId) {
              triggerGistSyncPush(parsed.tasks, parsed.people);
            }
            alert(`Success: Imported ${parsed.tasks.length} tasks and ${parsed.people.length} profiles!`);
          } else if (Array.isArray(parsed)) {
            saveTasksState(parsed);
            alert(`Success: Imported legacy tasks file (${parsed.length} tasks).`);
          } else {
            alert("Failed: Selected file is not a valid planner backup.");
          }
        } catch (err) {
          alert("Error parsing backup JSON file.");
        }
      };
    }
  };

  // --- Render calculations ---

  const progressPercent = Math.min((getWeekPoints(currentWeek) / settings.weeklyPointsLimit) * 100, 100);
  let progressBarColor = 'var(--accent-cyan)';
  if (progressPercent > 90) progressBarColor = 'var(--color-danger)';
  else if (progressPercent > 70) progressBarColor = 'var(--accent-purple)';

  // AI Dialog breakdown per person
  const pointsPerPerson: Record<string, number> = {};
  if (pendingTaskAction) {
    const currentWeekTasks = tasks.filter(t => t.week === pendingTaskAction.task.week);
    currentWeekTasks.forEach(t => {
      if (t.status !== 'done') {
        const name = t.requestedBy || 'Personal';
        pointsPerPerson[name] = (pointsPerPerson[name] || 0) + t.points;
      }
    });
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header glass">
        <div className="brand-section">
          <h1 className="brand-title">
            <Brain size={24} style={{ color: 'var(--accent-purple)' }} /> 
            FocusBoundary
          </h1>
          <span className="brand-subtitle">
            Focus & Capacity Coach
          </span>
        </div>



        {/* Week Navigator */}
        <div className="week-navigator">
          <button 
            className="nav-btn" 
            onClick={() => setCurrentWeek(getOffsetWeek(currentWeek, -1))}
            title="Previous Week"
          >
            ←
          </button>
          <span className="current-week-label">
            {formatWeekRange(currentWeek)}
          </span>
          <button 
            className="nav-btn" 
            onClick={() => setCurrentWeek(getOffsetWeek(currentWeek, 1))}
            title="Next Week"
          >
            →
          </button>
        </div>

        <div className="header-actions" style={{ position: 'relative' }}>
          <button 
            className="btn-icon" 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            title="Options Menu"
            aria-label="Options Menu"
          >
            <SettingsIcon size={18} />
          </button>

          {isMenuOpen && (
            <div className="dropdown-menu glass-elevated" style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              zIndex: 1000,
              minWidth: '220px',
              marginTop: '0.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.2rem',
              padding: '0.4rem',
              borderRadius: 'var(--radius-sm)',
              background: '#fdfcf7',
              border: '1px solid var(--border-color)',
              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.06), 0 4px 6px -2px rgba(0,0,0,0.03)'
            }}>
              {/* Sync Status Option */}
              {settings.githubPat && (
                <button 
                  className="dropdown-item" 
                  onClick={() => { triggerGistSyncPull(); setIsMenuOpen(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.5rem 0.6rem', fontSize: '0.8rem', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: '2px', fontFamily: 'var(--font-sans)' }}
                >
                  <div className={`sync-dot ${
                    syncStatus === 'synced' ? 'synced' : 
                    syncStatus === 'syncing' ? 'syncing' : ''
                  }`} style={{ width: '8px', height: '8px', borderRadius: '50%', background: syncStatus === 'synced' ? 'var(--color-success)' : syncStatus === 'syncing' ? 'var(--color-warning)' : 'var(--text-muted)' }} />
                  <span style={{ fontWeight: 500 }}>{syncStatus === 'syncing' ? 'Syncing...' : syncStatus === 'error' ? 'Sync Error' : 'Re-sync Gist'}</span>
                </button>
              )}

              {/* AI Review Option */}
              <button 
                className="dropdown-item" 
                onClick={() => { triggerManualNegotiation(); setIsMenuOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.5rem 0.6rem', fontSize: '0.8rem', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: '2px', fontFamily: 'var(--font-sans)' }}
              >
                <Brain size={13} style={{ color: 'var(--accent-purple)' }} />
                <span style={{ fontWeight: 500 }}>AI Capacity Review</span>
              </button>

              {/* Sizing Help Option */}
              <button 
                className="dropdown-item" 
                onClick={() => { toggleOnboarding(); setIsMenuOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.5rem 0.6rem', fontSize: '0.8rem', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: '2px', fontFamily: 'var(--font-sans)' }}
              >
                <span style={{ fontSize: '0.85rem', width: '13px', textAlign: 'center', fontWeight: 'bold' }}>?</span>
                <span style={{ fontWeight: 500 }}>Toggle Sizing Guide</span>
              </button>

              {/* Settings Option */}
              <button 
                className="dropdown-item" 
                onClick={() => { setIsSettingsOpen(true); setIsMenuOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.5rem 0.6rem', fontSize: '0.8rem', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: '2px', fontFamily: 'var(--font-sans)' }}
              >
                <SettingsIcon size={13} />
                <span style={{ fontWeight: 500 }}>Settings</span>
              </button>

              <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.3rem 0' }} />

              {/* Export Backup Option */}
              <button 
                className="dropdown-item" 
                onClick={() => { handleExportJSON(); setIsMenuOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.5rem 0.6rem', fontSize: '0.8rem', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: '2px', fontFamily: 'var(--font-sans)' }}
              >
                <Download size={13} />
                <span style={{ fontWeight: 500 }}>Export Backup (JSON)</span>
              </button>

              {/* Import Backup Option */}
              <label 
                className="dropdown-item" 
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.5rem 0.6rem', fontSize: '0.8rem', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: '2px', fontFamily: 'var(--font-sans)', boxSizing: 'border-box' }}
              >
                <Upload size={13} />
                <span style={{ fontWeight: 500 }}>Import Backup (JSON)</span>
                <input type="file" accept=".json" onChange={(e) => { handleImportJSON(e); setIsMenuOpen(false); }} style={{ display: 'none' }} />
              </label>
            </div>
          )}
        </div>
      </header>

      {/* Onboarding Banner */}
      {showOnboarding && (
        <div className="onboarding-banner animate-fade-in">
          <div className="onboarding-header">
            <span>Focus Protection & Sizing Model</span>
            <button className="btn-close-banner" onClick={toggleOnboarding} title="Dismiss guide">
              <X size={14} />
            </button>
          </div>
          <div className="onboarding-body">
            FocusBoundary protects you from burnout by enforcing a hard <strong>weekly story point capacity limit</strong>. When you try to save a task that pushes you over the limit, the save is paused, and the <strong>Capacity Assistant</strong> helps you reschedule, resize, or delete tasks to protect your week.
            <br /><br />
            <strong>What is a point?</strong> We size tasks by attention effort, not just hours:
            <div className="points-helper-grid" style={{ marginTop: '0.4rem' }}>
              <div className="points-helper-col">
                <strong>1 pt</strong>
                <span style={{ fontSize: '0.65rem' }}>Admin / Quick (&lt;30m)</span>
              </div>
              <div className="points-helper-col">
                <strong>2 pts</strong>
                <span style={{ fontSize: '0.65rem' }}>Minor task (1-2 hours)</span>
              </div>
              <div className="points-helper-col">
                <strong>3 pts</strong>
                <span style={{ fontSize: '0.65rem' }}>Focus block (2-4 hours)</span>
              </div>
              <div className="points-helper-col">
                <strong>5 pts</strong>
                <span style={{ fontSize: '0.65rem' }}>Substantial (half/full day)</span>
              </div>
              <div className="points-helper-col">
                <strong>8 pts</strong>
                <span style={{ fontSize: '0.65rem' }}>Complex Epic (split needed)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Contents */}
          {/* Quick Capture Input Form */}
          <form 
            onSubmit={handleQuickAdd} 
            className="glass animate-fade-in" 
            style={{ 
              display: 'flex', 
              gap: '0.5rem', 
              padding: '0.5rem 0.8rem', 
              background: '#fff', 
              borderBottom: '3px solid var(--border-color)', 
              marginBottom: '1rem', 
              alignItems: 'center' 
            }}
          >
            <input 
              type="text" 
              className="form-control" 
              style={{ 
                flexGrow: 1, 
                border: 'none', 
                background: 'transparent', 
                fontSize: '0.9rem', 
                padding: '0.3rem 0',
                outline: 'none',
                fontFamily: 'var(--font-sans)',
                color: 'var(--text-primary)'
              }}
              placeholder="✏️ Quick capture a task (e.g. Write report for Sarah 3 pts Monday)..."
              ref={quickCaptureInputRef}
              value={quickTaskTitle}
              onChange={e => setQuickTaskTitle(e.target.value)}
            />
            <button 
              type="submit" 
              className="btn-primary" 
              style={{ 
                padding: '0.4rem 0.8rem', 
                fontSize: '0.8rem', 
                borderRadius: 'var(--radius-sm)', 
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '0.2rem'
              }}
            >
              <Plus size={14} /> Capture
            </button>
          </form>

          {/* Progress / Capacity Dashboard */}
          {/* Progress / Capacity Dashboard */}
          <div className="capacity-card glass" style={{ marginBottom: '1.2rem', padding: '1rem' }}>
            <div className="capacity-header">
              <h3 className="capacity-title">Active Weekly Load</h3>
              <div className="capacity-fraction">
                {getWeekPoints(currentWeek)} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>/ {settings.weeklyPointsLimit} pts</span>
              </div>
            </div>
            <div className="capacity-bar-container">
              <div 
                className="capacity-bar-fill" 
                style={{ 
                  width: `${progressPercent}%`, 
                  background: progressBarColor 
                }}
              />
            </div>
            {getWeekPoints(currentWeek) > settings.weeklyPointsLimit ? (
              <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.3rem' }}>
                <div style={{ color: 'var(--color-danger)', fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: 600 }}>
                  <AlertTriangle size={12} /> Limit exceeded (+{getWeekPoints(currentWeek) - settings.weeklyPointsLimit} pts).
                </div>
                {settings.openaiApiKey && (
                  <button 
                    type="button"
                    onClick={handleTriggerManualTriage}
                    className="btn-primary"
                    style={{ 
                      padding: '0.15rem 0.4rem', 
                      fontSize: '0.68rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.2rem', 
                      margin: 0, 
                      borderRadius: '3px',
                      background: 'var(--color-danger)',
                      borderColor: 'var(--color-danger)'
                    }}
                  >
                    <Brain size={10} /> Auto-Triage
                  </button>
                )}
              </div>
            ) : progressPercent >= 100 ? (
              <div style={{ color: 'var(--color-warning)', fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600, marginTop: '0.5rem' }}>
                <AlertTriangle size={12} /> Full capacity limit met.
              </div>
            ) : null}
          </div>

          {/* Kanban / Grid Columns */}
          <main className="columns-container">
            {WEEKDAYS.map(day => {
              const dayTasks = tasks.filter(t => t.week === currentWeek && t.day === day);
              const dayPoints = getDayPoints(currentWeek, day);
              return (
                <section key={day} className="weekday-column glass">
                  <div className="column-header">
                    <span className="column-title">{day}</span>
                    <span className="column-points-badge">{dayPoints} pts</span>
                  </div>

                  <div className="task-list">
                    {dayTasks.map(task => (
                      <div 
                        key={task.id} 
                        className={`task-card ${task.status === 'done' ? 'completed' : ''}`}
                      >
                        <div className="task-card-header">
                          <label className="task-checkbox-container">
                            <input 
                              type="checkbox" 
                              className="task-checkbox" 
                              checked={task.status === 'done'}
                              onChange={() => toggleTaskStatus(task)}
                            />
                          </label>
                          <span className="task-title" onClick={() => openEditTask(task)}>
                            {task.title}
                          </span>
                          <span 
                            className={`task-points-badge badge-${task.points}`}
                            onClick={(e) => handleCyclePoints(task, e)}
                            style={{ cursor: 'pointer' }}
                            title="Click to cycle points size (1->2->3->5->8)"
                          >
                            {task.points}
                          </span>
                        </div>
                        {task.description && (
                          <p className="task-desc" onClick={() => openEditTask(task)}>
                            {task.description}
                          </p>
                        )}

                        
                        {/* Inline Weekday Picker */}
                        <div style={{ display: 'flex', gap: '0.2rem', marginTop: '0.4rem', borderTop: '1px dashed var(--border-color)', paddingTop: '0.4rem', marginBottom: '0.2rem' }}>
                          {(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as Weekday[]).map(wd => {
                            const isCurrent = task.day === wd;
                            const label = wd === 'Wednesday' ? 'W' : wd === 'Thursday' ? 'Th' : wd.charAt(0);
                            return (
                              <button
                                key={wd}
                                type="button"
                                onClick={(e) => handleMoveDay(task, wd, e)}
                                style={{
                                  padding: '0.1rem 0.25rem',
                                  fontSize: '0.6rem',
                                  fontFamily: 'var(--font-mono)',
                                  borderRadius: '2px',
                                  border: isCurrent ? '1px solid var(--accent-primary)' : '1px dashed var(--border-color)',
                                  background: isCurrent ? 'rgba(29, 78, 216, 0.08)' : 'transparent',
                                  color: isCurrent ? 'var(--accent-primary)' : 'var(--text-muted)',
                                  cursor: 'pointer',
                                  fontWeight: isCurrent ? 'bold' : 'normal',
                                  lineHeight: 1
                                }}
                                title={`Move to ${wd}`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.2rem' }}>
                          {task.requestedBy ? (
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.2rem', fontFamily: 'var(--font-mono)' }}>
                              <User size={10} /> for {task.requestedBy}
                            </span>
                          ) : (
                            <span />
                          )}
                          <div className="task-actions" style={{ margin: 0, border: 'none', paddingTop: 0 }}>
                            <button 
                              className="task-action-btn delete-btn" 
                              onClick={() => handleDeleteTask(task.id)}
                              title="Delete Task"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button 
                    className="btn-add-task-inline" 
                    onClick={() => openAddTask(day)}
                  >
                    <Plus size={13} /> Add Task
                  </button>
                </section>
              );
            })}
          </main>



      {/* Add / Edit Task Dialog */}
      <dialog ref={taskDialogRef} onClose={() => setIsTaskModalOpen(false)}>
        <div className="modal-content glass-elevated">
          <div className="modal-header">
            <h2 className="modal-title">{editingTask ? 'Edit Task' : 'Add Task'}</h2>
            <button className="btn-icon" onClick={() => setIsTaskModalOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSaveTask} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group">
              <label htmlFor="task-title-input">Task Title</label>
              <input 
                id="task-title-input"
                type="text" 
                className="form-control" 
                value={taskTitle} 
                onChange={e => handleTitleChange(e.target.value)} 
                placeholder="What do you need to do? (Type 'for [Name]' to assign)"
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="task-desc-input">Description (Optional)</label>
              <textarea 
                id="task-desc-input"
                className="form-control" 
                value={taskDesc} 
                onChange={e => setTaskDesc(e.target.value)} 
                placeholder="Details or notes..."
                rows={2}
              />
            </div>

            <div className="points-helper-box">
              <h4>Effort Sizing Guide</h4>
              <p>Choose story points by required focus effort: <strong>1 pt</strong> = Quick admin task (&lt;30m); <strong>2 pts</strong> = Small task (1-2h); <strong>3 pts</strong> = Focus block (half-day); <strong>5 pts</strong> = Large project task (full day); <strong>8 pts</strong> = Complex epic (break down!).</p>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label htmlFor="task-points-select">Story Points (Capacity Size)</label>
                <select 
                  id="task-points-select"
                  className="form-control"
                  value={taskPoints}
                  onChange={e => setTaskPoints(Number(e.target.value) as any)}
                >
                  <option value={1}>1 pt (XS — Quick Admin, &lt;30m)</option>
                  <option value={2}>2 pts (S — Minor Task, 1-2h)</option>
                  <option value={3}>3 pts (M — Focus Block, 2-4h)</option>
                  <option value={5}>5 pts (L — Project Task, full day)</option>
                  <option value={8}>8 pts (XL — Complex Epic, split needed)</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="task-requested-by">For Person (Optional)</label>
                <input 
                  id="task-requested-by"
                  type="text" 
                  className="form-control" 
                  value={taskRequestedBy} 
                  onChange={e => setTaskRequestedBy(e.target.value)} 
                  placeholder="e.g. Sarah, Alex"
                  list="people-suggestions"
                />
                <datalist id="people-suggestions">
                  {people.map(p => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="form-grid-2" style={{ gridTemplateColumns: '1fr' }}>
              <div className="form-group">
                <label htmlFor="task-day-select">Scheduled Day</label>
                <select 
                  id="task-day-select"
                  className="form-control"
                  value={taskDay}
                  onChange={e => setTaskDay(e.target.value as Weekday)}
                >
                  {WEEKDAYS.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => setIsTaskModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Save Task
              </button>
            </div>
          </form>
        </div>
      </dialog>

      {/* Settings Dialog */}
      <dialog ref={settingsDialogRef} onClose={() => setIsSettingsOpen(false)}>
        <div className="modal-content glass-elevated">
          <div className="modal-header">
            <h2 className="modal-title">Settings</h2>
            <button className="btn-icon" onClick={() => setIsSettingsOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group">
              <label htmlFor="settings-openai-key" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Key size={14} /> OpenAI API Key
              </label>
              <input 
                id="settings-openai-key"
                type="password" 
                className="form-control" 
                value={settings.openaiApiKey}
                onChange={e => setSettings({ ...settings, openaiApiKey: e.target.value })}
                placeholder="sk-..."
              />
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Required to enable the AI Capacity Assistant. Stored only in your local browser.
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="settings-github-pat" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Globe size={14} /> GitHub Personal Access Token (PAT)
              </label>
              <input 
                id="settings-github-pat"
                type="password" 
                className="form-control" 
                value={settings.githubPat}
                onChange={e => setSettings({ ...settings, githubPat: e.target.value })}
                placeholder="ghp_..."
              />
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Required to sync tasks across your phone and computer. Needs `gist` scope.
              </span>
              <details style={{ marginTop: '0.3rem', fontSize: '0.72rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--accent-primary)', fontWeight: 500 }}>
                  How do I get a GitHub Personal Access Token (PAT)?
                </summary>
                <ol style={{ paddingLeft: '1.2rem', marginTop: '0.2rem', display: 'flex', flexDirection: 'column', gap: '0.2rem', color: 'var(--text-secondary)' }}>
                  <li>Go to <strong>GitHub.com</strong> and sign in.</li>
                  <li>Click your Profile Photo &gt; <strong>Settings</strong> &gt; <strong>Developer settings</strong> (at the bottom of the sidebar).</li>
                  <li>Select <strong>Personal access tokens</strong> &gt; <strong>Tokens (classic)</strong>.</li>
                  <li>Click <strong>Generate new token</strong> (classic).</li>
                  <li>Give it a description, check the <strong>gist</strong> scope, and click <strong>Generate token</strong>.</li>
                  <li>Copy the resulting token string and paste it into the field above.</li>
                </ol>
              </details>
            </div>

            <div className="form-group">
              <label htmlFor="settings-gist-id">Gist Database ID (Auto-Managed)</label>
              <input 
                id="settings-gist-id"
                type="text" 
                className="form-control" 
                value={settings.gistId}
                onChange={e => setSettings({ ...settings, gistId: e.target.value })}
                placeholder="Created automatically upon token save"
              />
            </div>

            <div className="form-group">
              <label htmlFor="settings-limit">Weekly Story Point Capacity Limit</label>
              <input 
                id="settings-limit"
                type="number" 
                className="form-control" 
                value={settings.weeklyPointsLimit}
                onChange={e => setSettings({ ...settings, weeklyPointsLimit: Number(e.target.value) })}
                min={5}
                max={100}
                required
              />
            </div>

            <div className="form-actions">
              <button type="submit" className="btn-primary">
                Save & Close
              </button>
            </div>
          </form>
        </div>
      </dialog>

      {/* Capacity Negotiator Chat Overlay */}
      <dialog ref={negotiatorDialogRef} onClose={handleCancelNegotiation} style={{ padding: 0, overflow: 'hidden' }}>
        {isNegotiating && pendingTaskAction && (
          <div className="agent-negotiator-container glass-elevated">
            
            {/* Left sidebar */}
            <aside className="agent-audit-sidebar">
              <div className="audit-banner">
                <Brain size={13} />
                <span>CAPACITY ASSISTANT</span>
              </div>

              <div className="audit-metric-group">
                <span className="audit-metric-label">
                  Active Load (Week {pendingTaskAction.task.week})
                </span>
                <span style={{ fontWeight: 'bold', fontSize: '1.1rem', fontFamily: 'var(--font-mono)' }}>
                  {getWeekPoints(pendingTaskAction.task.week)} / {settings.weeklyPointsLimit} pts
                </span>
                <div className="audit-metric-bar-container">
                  <div 
                    className="audit-metric-bar-fill" 
                    style={{ 
                      width: `${Math.min((getWeekPoints(pendingTaskAction.task.week) / settings.weeklyPointsLimit) * 100, 100)}%`,
                      backgroundColor: getWeekPoints(pendingTaskAction.task.week) > settings.weeklyPointsLimit ? 'var(--color-danger)' : 'var(--accent-purple)'
                    }}
                  />
                </div>
              </div>

              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.2rem' }}>
                TARGET TRANSACTION
              </div>
              <div className="audit-task-card" style={{ borderColor: 'var(--accent-cyan)' }}>
                <div className="audit-task-header">
                  <span className="audit-task-title" style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
                    {pendingTaskAction.task.title}
                  </span>
                  <span className="task-points-badge badge-3" style={{ fontSize: '0.62rem' }}>
                    +{pendingTaskAction.task.points} pts
                  </span>
                </div>
                <div className="audit-task-meta">
                  <span>Day: {pendingTaskAction.task.day}</span>
                  <span>Assignee: {pendingTaskAction.task.requestedBy || 'Personal'}</span>
                </div>
              </div>

              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.2rem', marginTop: '0.4rem' }}>
                WEEKLY LOAD PER PERSON
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', background: 'rgba(0,0,0,0.01)', border: '1px solid var(--border-color)', padding: '0.5rem', borderRadius: '4px' }}>
                {Object.entries(pointsPerPerson).map(([name, pts]) => (
                  <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span>{name}</span>
                    <strong style={{ fontFamily: 'var(--font-mono)' }}>{pts} pts</strong>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.2rem', marginTop: '0.4rem' }}>
                RUNNING WEEKLY SCHEDULE
              </div>
              <div className="audit-task-list">
                {tasks
                  .filter(t => t.week === pendingTaskAction.task.week && t.status !== 'done')
                  .map(t => (
                    <div key={t.id} className="audit-task-card">
                      <div className="audit-task-header">
                        <span className="audit-task-title">{t.title}</span>
                        <span className={`task-points-badge badge-${t.points}`} style={{ fontSize: '0.62rem' }}>
                          {t.points} pts
                        </span>
                      </div>
                      <div className="audit-task-meta">
                        <span>Day: {t.day}</span>
                        <span>Assignee: {t.requestedBy || 'Personal'}</span>
                      </div>
                    </div>
                  ))
                }
              </div>

              <button 
                className="btn-secondary" 
                style={{ width: '100%', borderColor: 'var(--color-danger)', color: 'var(--color-danger)', fontSize: '0.8rem', marginTop: '0.4rem' }} 
                onClick={handleCancelNegotiation}
              >
                Abort & Drop Task
              </button>
            </aside>

            {/* Right Side Chat */}
            <main className="agent-chat-panel">
              <header className="agent-chat-header">
                <div className="agent-avatar">CA</div>
                <div>
                  <div className="agent-chat-title">Capacity Assistant</div>
                  <div className="agent-chat-subtitle">Focus & Capacity Guardian</div>
                </div>
              </header>

              <div className="chat-message-list">
                {agentMessages.map(msg => (
                  <div 
                    key={msg.id} 
                    className={`chat-bubble ${msg.sender === 'agent' ? 'agent' : 'user'} ${msg.text.startsWith('⚙️') ? 'tool-status' : ''}`}
                    dangerouslySetInnerHTML={{ 
                      __html: msg.text
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\*(.*?)\*/g, '<em>$1</em>')
                        .replace(/\n/g, '<br />')
                        .replace(/^- (.*?)$/gm, '• $1')
                    }}
                  />
                ))}

                {isAgentTyping && (
                  <div className="chat-bubble agent" style={{ padding: '0.3rem 0.6rem' }}>
                    <div className="typing-indicator">
                      <div className="typing-dot" />
                      <div className="typing-dot" />
                      <div className="typing-dot" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="chat-input-bar">
                <input 
                  type="text" 
                  className="chat-input"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendAgentMessage()}
                  placeholder="Propose a compromise..."
                  disabled={isAgentTyping}
                  autoFocus
                />
                <button 
                  className="chat-send-btn" 
                  onClick={handleSendAgentMessage}
                  disabled={isAgentTyping || !chatInput.trim()}
                >
                  <Send size={16} />
                </button>
              </div>
            </main>

          </div>
        )}
      </dialog>

      {/* Undo Toast Banner */}
      {showUndoToast && deletedTaskBackup && (
        <div 
          className="glass-elevated animate-fade-in" 
          style={{ 
            position: 'fixed', 
            bottom: '1.5rem', 
            left: '50%', 
            transform: 'translateX(-50%)', 
            background: '#fdfbdf', 
            border: '1px solid #e7df95',
            borderBottom: '3px solid var(--border-color)',
            padding: '0.6rem 1.2rem', 
            zIndex: 10000, 
            display: 'flex', 
            alignItems: 'center', 
            gap: '1rem',
            borderRadius: 'var(--radius-md)'
          }}
        >
          <span style={{ fontSize: '0.78rem', color: '#6d6528', fontWeight: 500 }}>
            Task deleted: "<strong>{deletedTaskBackup.title}</strong>"
          </span>
          <button 
            type="button"
            onClick={handleUndoDelete}
            className="btn-primary"
            style={{ 
              padding: '0.25rem 0.6rem', 
              fontSize: '0.7rem', 
              margin: 0, 
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-primary)',
              borderColor: 'var(--accent-primary)',
              color: '#fff',
              cursor: 'pointer',
              lineHeight: 1
            }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
