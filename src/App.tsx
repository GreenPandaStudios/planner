import { useState, useEffect, useRef, useCallback } from 'react';
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
  User,
  Ban
} from 'lucide-react';
import type { Task, AppSettings, AgentChatMessage, Person, TaskMetadata } from './types';
import { 
  findExistingGist, 
  createPrivateGist, 
  fetchTasksFromGist, 
  saveTasksToGist 
} from './utils/github-sync';
import { runAgentStep } from './agent/agent-engine';
import type { AgentMessage, AgentContext } from './agent/agent-engine';
import { triageLocally, triageWithAI, silentRebalance, getTodaySuggestion, shouldBreakDown, expandToSubtasks, getOffsetWeekFromNow, autoFillToday } from './agent/triage-engine';
import FocusMode from './components/FocusMode';
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
  weeklyPointsLimit: 30,
  dailyPointsLimit: 7,
  customTriagePrompt: ''
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
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const [appMode, setAppMode] = useState<'work' | 'personal'>(() => {
    const saved = localStorage.getItem('antigravity_planner_mode');
    return (saved === 'work' || saved === 'personal') ? saved : 'work';
  });

  const handleSetAppMode = (mode: 'work' | 'personal') => {
    setAppMode(mode);
    localStorage.setItem('antigravity_planner_mode', mode);
  };
  const [isNegotiating, setIsNegotiating] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
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
  const [taskToday, setTaskToday] = useState(false);
  const [taskWeek, setTaskWeek] = useState('');
  const [taskRequestedBy, setTaskRequestedBy] = useState('');
  const [taskDelegated, setTaskDelegated] = useState(false);
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

  // --- Toast system ---
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const addToast = useCallback((text: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, text }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // --- Today's focus suggestion ---
  const [todaySuggestion, setTodaySuggestion] = useState<string | null>(null);
  // --- Focus Mode ---
  const [focusTask, setFocusTask] = useState<Task | null>(null);

  // --- Drag and Drop State ---
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [dragOverSection, setDragOverSection] = useState<'today' | 'week' | 'next-week' | 'later' | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // Native dialog refs
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  const taskDialogRef = useRef<HTMLDialogElement>(null);
  const quickCaptureInputRef = useRef<HTMLInputElement>(null);

  // --- Initialization ---
  useEffect(() => {
    const week = getIsoWeek(new Date());
    setCurrentWeek(week);

    const savedSettings = localStorage.getItem('antigravity_planner_settings');
    let loadedSettings: AppSettings = DEFAULT_SETTINGS;
    if (savedSettings) {
      try { loadedSettings = JSON.parse(savedSettings); setSettings(loadedSettings); } catch (e) { console.error('Error loading settings', e); }
    }

    let loadedTasks: Task[] = [];
    const savedTasks = localStorage.getItem('antigravity_planner_tasks');
    if (savedTasks) {
      try { loadedTasks = JSON.parse(savedTasks); setTasks(loadedTasks); } catch (e) { console.error('Error loading tasks', e); }
    }

    const savedPeople = localStorage.getItem('antigravity_planner_people');
    if (savedPeople) {
      try { setPeople(JSON.parse(savedPeople)); } catch (e) { console.error('Error loading people', e); }
    }

    // New day load check: runs autoFillToday autopilot silently
    const todayStr = new Date().toDateString();
    const lastOpened = localStorage.getItem('antigravity_planner_last_opened_date');
    if (lastOpened !== todayStr) {
      const updatedWithAutofill = autoFillToday(loadedTasks, week, loadedSettings.dailyPointsLimit || 7);
      setTasks(updatedWithAutofill);
      localStorage.setItem('antigravity_planner_tasks', JSON.stringify(updatedWithAutofill));
      localStorage.setItem('antigravity_planner_last_opened_date', todayStr);
      loadedTasks = updatedWithAutofill;
    }

    // Compute today suggestion silently on load
    getTodaySuggestion(loadedTasks, week, loadedSettings.openaiApiKey)
      .then(suggestion => setTodaySuggestion(suggestion))
      .catch(() => {});

    // Auto-focus quick-add input on startup
    setTimeout(() => {
      quickCaptureInputRef.current?.focus();
    }, 50);
  }, []);

  // --- PWA Install Prompt & iOS Support ---
  useEffect(() => {
    // Don't show if already installed (running in standalone)
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    // Detect iOS
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);

    if (ios) {
      const dismissed = localStorage.getItem('pwa_install_dismissed') === 'true';
      if (!dismissed) {
        const timer = setTimeout(() => {
          setShowInstallBanner(true);
        }, 3000);
        return () => clearTimeout(timer);
      }
    }

    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
      const dismissed = localStorage.getItem('pwa_install_dismissed') === 'true';
      if (!dismissed) {
        setShowInstallBanner(true);
      }
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowInstallBanner(false);
      setInstallPrompt(null);
      localStorage.setItem('pwa_install_dismissed', 'true');
    }
  };

  const dismissInstallBanner = () => {
    setShowInstallBanner(false);
    localStorage.setItem('pwa_install_dismissed', 'true');
  };

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
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
    } catch {
      setSyncStatus('error');
    }
  };

  const triggerGistSyncPush = async (tasksToPush: Task[], peopleToPush: Person[]) => {
    if (!settings.githubPat || !settings.gistId) return;
    setSyncStatus('syncing');
    try {
      await saveTasksToGist(settings.githubPat, settings.gistId, tasksToPush, peopleToPush);
      setSyncStatus('synced');
    } catch {
      setSyncStatus('error');
    }
  };

  // --- Point & Load Computations ---
  const getWeekPoints = (weekStr: string, taskList: Task[] = tasks) => {
    return taskList
      .filter(t => t.week === weekStr && t.status !== 'done')
      .reduce((sum, t) => sum + t.points, 0);
  };

  const getTodayPoints = (taskList: Task[] = tasks) => {
    return taskList
      .filter(t => t.week === currentWeek && t.today && t.status !== 'done')
      .reduce((sum, t) => sum + t.points, 0);
  };

  const getDailyCompletionHistory = () => {
    const dailyPoints: Record<string, number> = {};
    const todayDate = new Date();
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(todayDate.getDate() - i);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dailyPoints[dateStr] = 0;
    }

    tasks.forEach(t => {
      if (t.status === 'done' && t.completedAt) {
        const completedDate = new Date(t.completedAt);
        const dateStr = completedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (dateStr in dailyPoints) {
          dailyPoints[dateStr] += t.points;
        }
      }
    });

    return Object.entries(dailyPoints).map(([date, pts]) => ({ date, pts }));
  };

  const getVelocityStats = () => {
    const doneTasks = tasks.filter(t => t.status === 'done');
    const totalPoints = doneTasks.reduce((s, t) => s + t.points, 0);
    
    const uniqueDays = new Set<string>();
    doneTasks.forEach(t => {
      if (t.completedAt) {
        uniqueDays.add(new Date(t.completedAt).toDateString());
      }
    });
    
    const averageDaily = uniqueDays.size > 0 ? (totalPoints / uniqueDays.size).toFixed(1) : '0.0';
    
    let streak = 0;
    const d = new Date();
    while (true) {
      const dateStr = d.toDateString();
      const completedOnDay = doneTasks.some(t => t.completedAt && new Date(t.completedAt).toDateString() === dateStr);
      if (completedOnDay) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        if (streak === 0) {
          d.setDate(d.getDate() - 1);
          const completedYesterday = doneTasks.some(t => t.completedAt && new Date(t.completedAt).toDateString() === d.toDateString());
          if (completedYesterday) {
            streak++;
            d.setDate(d.getDate() - 1);
            continue;
          }
        }
        break;
      }
    }

    return {
      totalPoints,
      averageDaily,
      streak,
      activeDays: uniqueDays.size
    };
  };

  // --- Drag and Drop Handlers ---
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedTaskId(taskId);
  };

  const handleDragEnd = () => {
    setDraggedTaskId(null);
    setDragOverTaskId(null);
    setDragOverSection(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragEnterSection = (sectionKey: 'today' | 'week' | 'next-week' | 'later') => {
    if (draggedTaskId) {
      setDragOverSection(sectionKey);
    }
  };

  const handleDropOnSection = (e: React.DragEvent, targetSection: 'today' | 'week' | 'next-week' | 'later') => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
    
    setDraggedTaskId(null);
    setDragOverTaskId(null);
    setDragOverSection(null);

    if (!taskId) return;

    const nextWeek = getOffsetWeekFromNow(1);
    const laterWeek = getOffsetWeekFromNow(2);

    const draggedTask = tasks.find(t => t.id === taskId);
    if (!draggedTask) return;

    const updatedTargetToday = targetSection === 'today';
    const updatedTargetWeek = targetSection === 'today' || targetSection === 'week'
      ? currentWeek
      : targetSection === 'next-week'
        ? nextWeek
        : laterWeek;

    const updatedTask = {
      ...draggedTask,
      today: updatedTargetToday,
      week: updatedTargetWeek
    };

    const remaining = tasks.filter(t => t.id !== taskId);
    const newTasks = [...remaining, updatedTask];

    saveTasksState(newTasks);
    addToast(`Moved task to ${targetSection === 'today' ? 'Today' : targetSection === 'week' ? 'This Week' : targetSection === 'next-week' ? 'Next Week' : 'Later'}`);
  };

  const handleDropOnTask = (e: React.DragEvent, targetTaskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.getData('text/plain') || draggedTaskId;
    
    setDraggedTaskId(null);
    setDragOverTaskId(null);
    setDragOverSection(null);

    if (!draggedId || draggedId === targetTaskId) return;

    const draggedTask = tasks.find(t => t.id === draggedId);
    const targetTask = tasks.find(t => t.id === targetTaskId);
    if (!draggedTask || !targetTask) return;

    const updatedDragged = {
      ...draggedTask,
      today: targetTask.today,
      week: targetTask.week
    };

    const remaining = tasks.filter(t => t.id !== draggedId);
    const targetIdx = remaining.findIndex(t => t.id === targetTaskId);

    const newTasks = [...remaining];
    newTasks.splice(targetIdx, 0, updatedDragged);

    saveTasksState(newTasks);
    addToast(`Reordered tasks`);
  };

  // --- Today Promotion and Autopilot Handlers ---
  const handleToggleToday = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = tasks.map(t => {
      if (t.id === task.id) {
        const nextToday = !t.today;
        const nextWeek = nextToday && t.week !== currentWeek ? currentWeek : t.week;
        return {
          ...t,
          today: nextToday,
          week: nextWeek
        };
      }
      return t;
    });
    saveTasksState(updated);
    addToast(task.today ? `Removed from Today` : `Promoted to Today`);
  };

  const handleAutoFillToday = () => {
    const updated = autoFillToday(tasks, currentWeek, settings.dailyPointsLimit || 7);
    saveTasksState(updated);
    
    const oldTodayCount = tasks.filter(t => t.week === currentWeek && t.today && t.status !== 'done').length;
    const newTodayCount = updated.filter(t => t.week === currentWeek && t.today && t.status !== 'done').length;
    const diff = newTodayCount - oldTodayCount;
    if (diff > 0) {
      addToast(`🪄 Auto-filled ${diff} task(s) into Focus Today`);
    } else {
      addToast(`Focus Today is already full or no eligible tasks in backlog`);
    }
  };

  // --- Task Save & Validation ---
  const openAddTask = (section: 'today' | 'week' | 'next-week' | 'later') => {
    setEditingTask(null);
    setTaskTitle('');
    setTaskDesc('');
    setTaskPoints(1);
    setTaskRequestedBy('');
    setTaskDelegated(false);
    
    if (section === 'today') {
      setTaskToday(true);
      setTaskWeek(currentWeek);
    } else if (section === 'week') {
      setTaskToday(false);
      setTaskWeek(currentWeek);
    } else if (section === 'next-week') {
      setTaskToday(false);
      setTaskWeek(getOffsetWeekFromNow(1));
    } else {
      setTaskToday(false);
      setTaskWeek(getOffsetWeekFromNow(2));
    }
    
    setIsTaskModalOpen(true);
  };

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setTaskTitle(task.title);
    setTaskDesc(task.description || '');
    setTaskPoints(task.points);
    setTaskToday(!!task.today);
    setTaskWeek(task.week);
    setTaskRequestedBy(task.requestedBy || '');
    setTaskDelegated(!!task.delegated);
    setIsTaskModalOpen(true);
  };

  const handleTitleChange = (val: string) => {
    setTaskTitle(val);
    const match = val.match(/(?:for|to|with|asks?)\s+([A-Z][a-zA-Z]*)/);
    if (match && match[1]) {
      setTaskRequestedBy(match[1]);
    }
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = quickTaskTitle.trim();
    if (!raw) return;

    // Clear input immediately so user can keep typing/working
    setQuickTaskTitle('');

    const tempId = 'temp-' + Math.random().toString(36).substring(2, 9);
    
    // Quick heuristic parse to have a placeholder point size and target week
    const quickHeuristic = triageLocally(raw, currentWeek);
    
    const newTask: Task = {
      id: tempId,
      title: quickHeuristic.title,
      points: quickHeuristic.points,
      week: quickHeuristic.week || currentWeek,
      today: quickHeuristic.today || false,
      status: 'todo',
      createdAt: Date.now(),
      triaging: true, // Mark as background triaging!
      requestedBy: raw.match(/(?:for|to|with|asks?)\s+([A-Z][a-zA-Z]*)/)?.[1],
      metadata: {
        domain: appMode,
        priority: 'medium',
        energyLevel: 'medium',
        sentiment: 'neutral',
        urgency: 'flexible'
      }
    };

    // Save task immediately in state and localStorage
    const updatedTasks = [...tasks, newTask];
    setTasks(updatedTasks);
    localStorage.setItem('antigravity_planner_tasks', JSON.stringify(updatedTasks));

    const assignedRequester = newTask.requestedBy;
    let nextPeople = people;
    if (assignedRequester) {
      const exists = people.some(p => p.name.toLowerCase() === assignedRequester.toLowerCase());
      if (!exists) {
        const np: Person = { id: Math.random().toString(36).substring(2, 9), name: assignedRequester, createdAt: Date.now() };
        nextPeople = [...people, np];
        setPeople(nextPeople);
        localStorage.setItem('antigravity_planner_people', JSON.stringify(nextPeople));
      }
    }

    // Launch background async AI triage
    triageWithAI(raw, currentWeek, settings, tasks).then(async (triageResult) => {
      const finalTriage = triageResult || quickHeuristic;
      const parsedMeta = parseTaskMetadataLocally(finalTriage.title);
      parsedMeta.domain = appMode;

      // Handle subtask breakdown if needed
      if (shouldBreakDown(raw, finalTriage.weekOffset ?? 0)) {
        const parentTitle = finalTriage.title;
        // Fetch subtasks in the background
        expandToSubtasks(parentTitle, finalTriage.weekOffset ?? 0, currentWeek, settings.openaiApiKey)
          .then(subtasks => {
            const newSubtasks: Task[] = subtasks.map(s => ({
              id: Math.random().toString(36).substring(2, 9),
              title: s.title,
              points: s.points,
              week: s.week,
              status: 'todo' as const,
              createdAt: Date.now(),
              requestedBy: assignedRequester,
              parentProject: parentTitle,
              metadata: { priority: 'medium', urgency: 'flexible', energyLevel: 'medium', domain: appMode, sentiment: 'neutral' },
            }));

            setTasks(current => {
              // Remove the temporary parent task and add subtasks
              const filtered = current.filter(t => t.id !== tempId);
              const nextTasks = [...filtered, ...newSubtasks];
              localStorage.setItem('antigravity_planner_tasks', JSON.stringify(nextTasks));
              if (settings.githubPat && settings.gistId) triggerGistSyncPush(nextTasks, nextPeople);
              return nextTasks;
            });

            addToast(`🔗 "${parentTitle}" → split into ${newSubtasks.length} subtasks`);
          });
        return;
      }

      // Single task update
      setTasks(current => {
        const nextTasks = current.map(t => {
          if (t.id === tempId) {
            return {
              ...t,
              title: finalTriage.title,
              points: finalTriage.points,
              week: finalTriage.week || currentWeek,
              today: finalTriage.today || false,
              triaging: undefined, // remove triaging flag!
              metadata: parsedMeta
            };
          }
          return t;
        });

        localStorage.setItem('antigravity_planner_tasks', JSON.stringify(nextTasks));

        // Check for capacity limit breaches
        const finalWeek = finalTriage.week || currentWeek;
        const finalWeekPoints = nextTasks
          .filter(t => t.week === finalWeek && t.status !== 'done')
          .reduce((s, t) => s + t.points, 0);

        if (finalWeekPoints > settings.weeklyPointsLimit) {
          const breachedTask = nextTasks.find(t => t.id === tempId);
          if (breachedTask) {
            setPendingTaskAction({
              type: 'add',
              task: breachedTask
            });
            setIsNegotiating(true);
            addToast(`⚠️ Capacity limit reached. Open Coach in sidebar.`);
          }
        } else {
          addToast(`✓ Triaged "${finalTriage.title}" (${finalTriage.points}pt)`);
        }

        // Trigger Gist Sync Push
        if (settings.githubPat && settings.gistId) {
          triggerGistSyncPush(nextTasks, nextPeople);
        }

        // Background AI enrichment
        if (settings.openaiApiKey) {
          const updatedSingleTask = nextTasks.find(t => t.id === tempId);
          if (updatedSingleTask) {
            enrichTaskWithAI(updatedSingleTask, settings.openaiApiKey).then(enrichedMeta => {
              setTasks(current => {
                const next = current.map(t => t.id === tempId ? { ...t, metadata: enrichedMeta } : t);
                localStorage.setItem('antigravity_planner_tasks', JSON.stringify(next));
                if (settings.githubPat && settings.gistId) triggerGistSyncPush(next, nextPeople);
                return next;
              });
            });
          }
        }

        return nextTasks;
      });
    });
  };

  const handleTriggerManualTriage = () => {
    const currentWeekTasks = tasks.filter(t => t.week === currentWeek && t.status !== 'done');
    if (currentWeekTasks.length === 0) return;
    
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

    if (!localMeta.domain) {
      localMeta.domain = appMode;
    }

    // Delegation checks
    const wasDelegatedBefore = !!editingTask?.delegated;
    const delegatedToBefore = editingTask?.delegatedTo || '';
    const isNowDelegated = taskDelegated && !!cleanedName;
    const finalPoints = isNowDelegated ? 1 : taskPoints;

    const proposedTask: Task = {
      id: editingTask?.id || Math.random().toString(36).substring(2, 9),
      title: taskTitle,
      description: taskDesc,
      points: finalPoints as 1 | 2 | 3 | 5 | 8,
      week: taskWeek,
      today: taskToday,
      status: (editingTask?.status || 'todo') as 'todo' | 'in-progress' | 'done',
      createdAt: editingTask?.createdAt || Date.now(),
      requestedBy: cleanedName || undefined,
      metadata: localMeta,
      delegated: isNowDelegated || undefined,
      delegatedTo: isNowDelegated ? cleanedName : undefined,
    };

    let followUpTask: Task | null = null;
    if (isNowDelegated && (!wasDelegatedBefore || delegatedToBefore !== cleanedName)) {
      followUpTask = {
        id: Math.random().toString(36).substring(2, 9),
        title: `Follow up with ${cleanedName} on: ${taskTitle}`,
        description: `Follow up on delegated task: ${taskDesc || ''}`,
        points: 1,
        week: taskWeek,
        today: taskToday,
        status: 'todo',
        createdAt: Date.now(),
        metadata: {
          domain: localMeta?.domain || appMode || 'work',
          priority: 'medium',
          energyLevel: 'low',
          sentiment: 'neutral',
          urgency: 'critical',
          aiEnriched: true
        }
      };
    }

    const currentPointsExcludeTarget = tasks
      .filter(t => t.week === proposedTask.week && t.status !== 'done' && t.id !== proposedTask.id)
      .reduce((sum, t) => sum + t.points, 0);

    const totalProposedPoints = currentPointsExcludeTarget + proposedTask.points + (followUpTask ? followUpTask.points : 0);

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

    // Save people first if new
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

    if (followUpTask) {
      updatedTasks = [...updatedTasks, followUpTask];
      addToast(`Created follow-up task for ${cleanedName}`);
    }

    setIsTaskModalOpen(false);

    // Silent overflow rebalance
    if (totalProposedPoints > settings.weeklyPointsLimit) {
      silentRebalance(updatedTasks, proposedTask.week, settings.weeklyPointsLimit, settings.openaiApiKey)
        .then(moves => {
          let rebalanced = [...updatedTasks];
          for (const mv of moves) {
            rebalanced = rebalanced.map(t =>
              t.id === mv.taskId ? { ...t, week: mv.toWeek } : t
            );
            addToast(`Moved "${mv.label}" → next week`);
          }
          setTasks(rebalanced);
          localStorage.setItem('antigravity_planner_tasks', JSON.stringify(rebalanced));
          if (settings.githubPat && settings.gistId) triggerGistSyncPush(rebalanced, nextPeople);
        });
    }

    setTasks(updatedTasks);
    localStorage.setItem('antigravity_planner_tasks', JSON.stringify(updatedTasks));

    if (settings.openaiApiKey) {
      enrichTaskWithAI(proposedTask, settings.openaiApiKey).then(enrichedMeta => {
        setTasks(currentTasks => {
          const nextTasks = currentTasks.map(t =>
            t.id === proposedTask.id ? { ...t, metadata: enrichedMeta } : t
          );
          localStorage.setItem('antigravity_planner_tasks', JSON.stringify(nextTasks));
          if (settings.githubPat && settings.gistId) triggerGistSyncPush(nextTasks, nextPeople);
          return nextTasks;
        });
      });
    } else {
      if (settings.githubPat && settings.gistId) triggerGistSyncPush(updatedTasks, nextPeople);
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
  const initiateNegotiation = (pending: Task, currentTasks: Task[]) => {
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
        today: pendingTaskAction.task.today,
        week: pendingTaskAction.task.week,
        requestedBy: pendingTaskAction.task.requestedBy,
        metadata: pendingTaskAction.task.metadata
      },
      settings: settings,
      onPostponeTask: (taskId, targetWeek) => {
        setAgentMessages(prev => [...prev, {
          id: Math.random().toString(36).substring(2, 9),
          sender: 'agent',
          text: `⚙️ *Tool execution: Rescheduling task [ID: ${taskId}] to ${targetWeek}*`,
          timestamp: Date.now()
        }]);

        setTasks(prev => prev.map(t => {
          if (t.id === taskId) return { ...t, week: targetWeek, today: false };
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
          const updatedList = pendingTaskAction.type === 'edit'
            ? current.map(t => t.id === pendingTaskAction.task.id ? pendingTaskAction.task : t)
            : [...current, pendingTaskAction.task];
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

  const dailyHistory = getDailyCompletionHistory();
  const maxPts = Math.max(...dailyHistory.map(d => d.pts), 5);

  const modeFilteredTasks = tasks.filter(t => {
    const domain = t.metadata?.domain;
    if (!domain) return true;
    if (appMode === 'work') {
      return domain === 'work';
    } else {
      return domain === 'personal' || domain === 'health' || domain === 'other';
    }
  });

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

  if (focusTask) {
    return (
      <FocusMode
        task={focusTask}
        onDone={(taskId) => {
          const updated = tasks.map(t => {
            if (t.id === taskId) {
              return { 
                ...t, 
                status: 'done' as const,
                completedAt: Date.now()
              };
            }
            return t;
          });
          saveTasksState(updated);
          addToast(`✓ Focused task completed!`);
          setFocusTask(null);
        }}
        onExit={() => setFocusTask(null)}
      />
    );
  }

  const renderTaskSectionList = (
    title: string,
    sectionKey: 'today' | 'week' | 'next-week' | 'later',
    sectionTasks: Task[],
    pointsLimit?: number
  ) => {
    const todoTasks = sectionTasks.filter(t => t.status !== 'done');
    const doneTasks = sectionTasks.filter(t => t.status === 'done');
    const totalPoints = sectionTasks.filter(t => t.status !== 'done').reduce((s, t) => s + t.points, 0);

    const isSectionHovered = dragOverSection === sectionKey;

    return (
      <section 
        className={`weekday-column glass ${isSectionHovered ? 'drag-hover-section' : ''}`}
        style={{ 
          width: '100%', 
          minHeight: '120px', 
          padding: '1rem', 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '0.6rem',
          border: isSectionHovered ? '2px dashed var(--accent-primary)' : '1px solid var(--border-color)',
          background: isSectionHovered ? 'rgba(29, 78, 216, 0.05)' : undefined,
          transition: 'all 0.2s ease-in-out'
        }}
        onDragOver={handleDragOver}
        onDragEnter={() => handleDragEnterSection(sectionKey)}
        onDrop={(e) => handleDropOnSection(e, sectionKey)}
      >
        <div className="column-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="column-title" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {sectionKey === 'today' ? '☀️' : sectionKey === 'week' ? '📥' : sectionKey === 'next-week' ? '📅' : '⏳'}
            {title}
          </span>
          <span className="column-points-badge" style={{ fontSize: '0.82rem', padding: '0.2rem 0.5rem' }}>
            {totalPoints} {pointsLimit ? `/ ${pointsLimit}` : ''} pts
          </span>
        </div>

        {sectionKey === 'today' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {todaySuggestion && todoTasks.length > 1 && (
              <div style={{
                background: 'rgba(29,78,216,0.06)',
                border: '1px solid rgba(29,78,216,0.15)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.45rem 0.6rem',
                fontSize: '0.82rem',
                color: 'var(--accent-primary)',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}>
                <span>🎯</span>
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginRight: '0.2rem' }}>Start with:</span>
                {todaySuggestion}
              </div>
            )}
            <button
              onClick={handleAutoFillToday}
              className="btn-secondary"
              style={{
                fontSize: '0.74rem',
                padding: '0.3rem 0.6rem',
                minHeight: '36px',
                width: 'fit-content',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                borderColor: 'rgba(29, 78, 216, 0.3)',
                color: 'var(--accent-primary)',
                background: 'rgba(29, 78, 216, 0.02)'
              }}
            >
              🪄 Auto-Fill Today
            </button>
          </div>
        )}

        <div className="task-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[...todoTasks, ...doneTasks].map(task => {
            const isDraggingThis = draggedTaskId === task.id;
            const isDragOverThis = dragOverTaskId === task.id;

            if (task.triaging) {
              return (
                <div 
                  key={task.id} 
                  className="task-card triaging-card animate-pulse"
                  style={{ transition: 'all 0.15s ease' }}
                >
                  <div className="shimmer-effect"></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', position: 'relative', zIndex: 2 }}>
                    <span style={{ fontSize: '0.9rem', animation: 'writing-bounce 1s infinite alternate ease-in-out', display: 'inline-block' }}>✏️</span>
                    <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                      <span style={{ fontStyle: 'italic', color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 500 }}>
                        {task.title}
                      </span>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        Sizing & scheduling in background...
                      </span>
                    </div>
                    <button 
                      type="button"
                      className="task-action-btn delete-btn" 
                      onClick={() => handleDeleteTask(task.id)}
                      title="Cancel background task"
                      style={{ padding: '0.2rem', minHeight: 'auto', border: 'none', background: 'transparent' }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div 
                key={task.id} 
                className={`task-card ${task.status === 'done' ? 'completed' : ''} ${isDraggingThis ? 'dragging' : ''} ${isDragOverThis ? 'drag-over' : ''}`}
                draggable={task.status !== 'done'}
                onDragStart={(e) => handleDragStart(e, task.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (draggedTaskId && draggedTaskId !== task.id && task.status !== 'done') {
                    if (dragOverTaskId !== task.id) {
                      setDragOverTaskId(task.id);
                      setDragOverSection(null);
                    }
                  }
                }}
                onDragLeave={() => {
                  if (dragOverTaskId === task.id) {
                    setDragOverTaskId(null);
                  }
                }}
                onDrop={(e) => handleDropOnTask(e, task.id)}
                style={{ 
                  cursor: task.status === 'done' ? 'default' : 'grab',
                  opacity: isDraggingThis ? 0.4 : 1,
                  borderTop: isDragOverThis ? '3px solid var(--accent-primary)' : undefined,
                  transform: isDragOverThis ? 'translateY(2px)' : undefined,
                  transition: 'all 0.15s ease'
                }}
              >
                {task.parentProject && (
                  <div style={{ 
                    fontSize: '0.7rem', 
                    color: 'var(--accent-primary)',
                    background: 'rgba(29, 78, 216, 0.05)',
                    padding: '0.15rem 0.4rem',
                    borderRadius: '3px',
                    marginBottom: '0.35rem', 
                    display: 'inline-flex', 
                    alignItems: 'center', 
                    gap: '0.2rem',
                    fontWeight: 600,
                    width: 'fit-content',
                    fontFamily: 'var(--font-sans)',
                  }}>
                    <span>🔗</span>
                    <span>{task.parentProject}</span>
                  </div>
                )}
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
                    title="Tap to cycle size"
                  >
                    {task.points}
                  </span>
                </div>
                {task.description && (
                  <p className="task-desc" onClick={() => openEditTask(task)}>
                    {task.description}
                  </p>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {task.status !== 'done' && (
                      <button
                        className="focus-btn"
                        onClick={(e) => handleToggleToday(task, e)}
                        style={{
                          background: task.today ? 'rgba(29, 78, 216, 0.15)' : 'rgba(29, 78, 216, 0.05)',
                          color: 'var(--accent-primary)',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0.35rem 0.65rem',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          minHeight: '36px',
                          transition: 'background 0.2s',
                        }}
                      >
                        {task.today ? '★ Today' : '☆ Today'}
                      </button>
                    )}
                    {task.points >= 3 && task.status !== 'done' && (
                      <button
                        className="focus-btn"
                        onClick={() => setFocusTask(task)}
                        style={{
                          background: 'rgba(29, 78, 216, 0.08)',
                          color: 'var(--accent-primary)',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0.35rem 0.65rem',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          minHeight: '36px',
                          transition: 'background 0.2s',
                        }}
                      >
                        ▶ Focus
                      </button>
                    )}
                    {task.requestedBy && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.2rem', fontFamily: 'var(--font-mono)' }}>
                        <User size={11} /> {task.delegated ? `delegated to ${task.requestedBy}` : `for ${task.requestedBy}`}
                      </span>
                    )}
                  </div>
                  <button 
                    className="task-action-btn delete-btn" 
                    onClick={() => handleDeleteTask(task.id)}
                    title="Delete Task"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
          {sectionTasks.length === 0 && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
              No tasks. Drag tasks here or add one below.
            </div>
          )}
        </div>

        <button 
          className="btn-add-task-inline" 
          onClick={() => openAddTask(sectionKey)}
          style={{ marginTop: '0.4rem' }}
        >
          <Plus size={14} /> Add Task
        </button>
      </section>
    );
  };

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



        {/* Week Date Info */}
        <div className="week-navigator" style={{ pointerEvents: 'none' }}>
          <span className="current-week-label" style={{ fontWeight: 600 }}>
            {formatWeekRange(currentWeek)}
          </span>
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

      {/* PWA Install Banner */}
      {showInstallBanner && (
        <div className="pwa-install-popup">
          <div className="pwa-install-header">
            <span className="pwa-install-icon">🧠</span>
            <div className="pwa-install-title">Add to Home Screen</div>
          </div>
          
          <div className="pwa-install-desc">
            {isIOS ? (
              <span>
                Tap the share button
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', margin: '0 0.3rem', color: 'var(--accent-primary)' }}>
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                and select <strong>"Add to Home Screen"</strong> to install FocusBoundary on your device.
              </span>
            ) : (
              "Install FocusBoundary on your device for offline access and capacity coaching."
            )}
          </div>

          <div className="pwa-install-actions">
            <button
              onClick={dismissInstallBanner}
              className="btn-secondary"
              style={{ padding: '0.4rem 0.8rem', minHeight: '36px', fontSize: '0.8rem' }}
            >
              {isIOS ? 'Close' : 'Not now'}
            </button>
            {!isIOS && (
              <button
                onClick={handleInstall}
                className="btn-primary"
                style={{ padding: '0.4rem 1rem', minHeight: '36px', fontSize: '0.8rem' }}
              >
                Install
              </button>
            )}
          </div>
        </div>
      )}

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

      {/* Main Workspace Layout */}
      <div className={`main-content-layout ${isNegotiating && pendingTaskAction ? 'has-sidebar' : ''}`}>
        <div className="planner-main-panel" style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>

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
              placeholder='✏️ Add a task — AI will size and schedule it in the background'
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
              <Plus size={14} /> Add
            </button>
          </form>

          {/* Progress / Capacity Dashboard */}
          <div className="capacity-card glass" style={{ marginBottom: '1.2rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.2rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Today's Focus Load</span>
                  <span style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {getTodayPoints()} <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}>/ {settings.dailyPointsLimit || 7} pts</span>
                  </span>
                </div>
                <div className="capacity-bar-container" style={{ height: '6px' }}>
                  <div 
                    className="capacity-bar-fill" 
                    style={{ 
                      width: `${Math.min(100, (getTodayPoints() / (settings.dailyPointsLimit || 7)) * 100)}%`, 
                      background: getTodayPoints() > (settings.dailyPointsLimit || 7) ? 'var(--color-danger)' : 'var(--accent-primary)' 
                    }}
                  />
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.2rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Active Weekly Load</span>
                  <span style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {getWeekPoints(currentWeek)} <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}>/ {settings.weeklyPointsLimit} pts</span>
                  </span>
                </div>
                <div className="capacity-bar-container" style={{ height: '6px' }}>
                  <div 
                    className="capacity-bar-fill" 
                    style={{ 
                      width: `${progressPercent}%`, 
                      background: getWeekPoints(currentWeek) > settings.weeklyPointsLimit ? 'var(--color-danger)' : progressBarColor 
                    }}
                  />
                </div>
              </div>
            </div>
            
            {(getTodayPoints() > (settings.dailyPointsLimit || 7) || getWeekPoints(currentWeek) > settings.weeklyPointsLimit) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.3rem', borderTop: '1px dashed var(--border-color)', paddingTop: '0.5rem' }}>
                <div style={{ color: 'var(--color-danger)', fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: 600 }}>
                  <AlertTriangle size={12} /> Limit exceeded!
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
            )}
          </div>

          {/* Insights & Trends Card */}
          <div className="capacity-card glass" style={{ marginBottom: '1.2rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem', fontFamily: 'var(--font-sans)', color: 'var(--text-secondary)' }}>
                📈 Daily Velocity & Insights
              </span>
              <button 
                type="button"
                className="btn-secondary" 
                onClick={() => setIsInsightsOpen(!isInsightsOpen)}
                style={{ fontSize: '0.74rem', padding: '0.2rem 0.5rem', minHeight: '28px', width: 'auto' }}
              >
                {isInsightsOpen ? 'Hide Insights' : 'Show Insights'}
              </button>
            </div>

            {isInsightsOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem', borderTop: '1px dashed var(--border-color)', paddingTop: '0.8rem' }}>
                
                {/* Stats Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.8rem', textAlign: 'center' }}>
                  <div style={{ background: '#fdfcf7', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.5rem' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                      {getVelocityStats().streak}🔥
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>Active Streak</div>
                  </div>
                  <div style={{ background: '#fdfcf7', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.5rem' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                      {getVelocityStats().averageDaily}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>Avg Pts/Day</div>
                  </div>
                  <div style={{ background: '#fdfcf7', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.5rem' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                      {getVelocityStats().totalPoints}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>Total Pts</div>
                  </div>
                </div>

                {/* Daily Velocity Chart */}
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.6rem' }}>
                    Velocity (Last 7 Days)
                  </div>
                  
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'flex-end', 
                    height: '110px', 
                    borderBottom: '2px solid var(--text-primary)', 
                    paddingBottom: '0.3rem',
                    gap: '0.4rem'
                  }}>
                    {dailyHistory.map((item, idx) => {
                      const pct = (item.pts / maxPts) * 100;
                      return (
                        <div key={idx} style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          alignItems: 'center', 
                          flexGrow: 1, 
                          height: '100%', 
                          justifyContent: 'flex-end' 
                        }}>
                          {item.pts > 0 && (
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: '0.2rem' }}>
                              {item.pts}
                            </span>
                          )}
                          <div 
                            style={{ 
                              width: '100%', 
                              height: `${pct}%`, 
                              minHeight: item.pts > 0 ? '4px' : '0px',
                              background: item.pts > 0 
                                ? 'repeating-linear-gradient(45deg, rgba(29, 78, 216, 0.15), rgba(29, 78, 216, 0.15) 3px, #ffffff 3px, #ffffff 6px)' 
                                : 'transparent',
                              border: item.pts > 0 ? '1px solid var(--border-color)' : 'none',
                              borderBottom: 'none',
                              borderRadius: '3px 3px 0 0',
                              transition: 'height 0.3s ease'
                            }} 
                            title={`${item.pts} points on ${item.date}`}
                          />
                          <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '0.3rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {item.date}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* Work / Personal Context Switcher */}
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0px' }}>
            <button
              type="button"
              onClick={() => handleSetAppMode('work')}
              style={{
                flex: 1,
                border: '1px solid var(--border-color)',
                borderBottom: appMode === 'work' ? '2px solid var(--accent-primary)' : 'none',
                borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                background: appMode === 'work' ? 'var(--bg-surface)' : 'transparent',
                color: appMode === 'work' ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: 700,
                fontSize: '0.85rem',
                padding: '0.6rem 1rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem',
                minHeight: '44px',
                transition: 'all 0.15s ease',
                outline: 'none'
              }}
            >
              💼 Work Backlog
            </button>
            <button
              type="button"
              onClick={() => handleSetAppMode('personal')}
              style={{
                flex: 1,
                border: '1px solid var(--border-color)',
                borderBottom: appMode === 'personal' ? '2px solid var(--accent-primary)' : 'none',
                borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                background: appMode === 'personal' ? 'var(--bg-surface)' : 'transparent',
                color: appMode === 'personal' ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: 700,
                fontSize: '0.85rem',
                padding: '0.6rem 1rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem',
                minHeight: '44px',
                transition: 'all 0.15s ease',
                outline: 'none'
              }}
            >
              🏠 Personal Backlog
            </button>
          </div>

          {/* Stacked Horizons Sections */}
          <main className="columns-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', padding: 0 }}>
            {renderTaskSectionList('Focus Today', 'today', modeFilteredTasks.filter(t => t.week === currentWeek && t.today), settings.dailyPointsLimit || 7)}
            {renderTaskSectionList("This Week's Backlog", 'week', modeFilteredTasks.filter(t => t.week === currentWeek && !t.today), settings.weeklyPointsLimit)}
            {renderTaskSectionList('Next Week', 'next-week', modeFilteredTasks.filter(t => t.week === getOffsetWeekFromNow(1)))}
            {renderTaskSectionList('Later', 'later', modeFilteredTasks.filter(t => t.week > getOffsetWeekFromNow(1)))}
          </main>
        </div>

        {/* Capacity Negotiator Sidebar Drawer */}
        {isNegotiating && pendingTaskAction && (
          <aside className="agent-sidebar-drawer glass-elevated">
            <div className="agent-negotiator-container">
              
              {/* Left strip metrics */}
              <div className="agent-audit-sidebar">
                <div className="audit-banner">
                  <Brain size={16} style={{ marginBottom: '0.1rem' }} />
                  <span>AUDIT</span>
                </div>

                <div className="audit-metric-group">
                  <span className="audit-metric-label">
                    WEEK {pendingTaskAction.task.week.replace(/^.*-W/, '')}
                  </span>
                  <span style={{ fontWeight: 'bold', fontSize: '0.9rem', fontFamily: 'var(--font-mono)', color: 'var(--color-danger)' }}>
                    {getWeekPoints(pendingTaskAction.task.week)}/{settings.weeklyPointsLimit}
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

                <div className="audit-task-card">
                  <div className="audit-task-header">
                    <span className="audit-task-title" style={{ fontSize: '0.65rem', fontWeight: 600 }}>
                      {pendingTaskAction.task.title}
                    </span>
                    <span className="audit-task-meta" style={{ fontSize: '0.6rem', fontWeight: 700, marginTop: '0.2rem' }}>
                      +{pendingTaskAction.task.points} pts
                    </span>
                  </div>
                </div>

                <button 
                  type="button"
                  className="btn-abort"
                  onClick={handleCancelNegotiation}
                  title="Abort & Drop proposed task"
                  style={{ cursor: 'pointer' }}
                >
                  <Ban size={11} style={{ marginRight: '0.2rem' }} /> Abort
                </button>
              </div>

              {/* Right Side Chat */}
              <div className="agent-chat-panel">
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
                    type="button"
                    className="chat-send-btn" 
                    onClick={handleSendAgentMessage}
                    disabled={isAgentTyping || !chatInput.trim()}
                  >
                    <Send size={14} />
                  </button>
                </div>
              </div>

            </div>
          </aside>
        )}
      </div>



      {/* Add / Edit Task Dialog */}
      <dialog ref={taskDialogRef} onClose={() => setIsTaskModalOpen(false)}>
        <div className="modal-content glass-elevated">
          <div className="modal-header">
            <h2 className="modal-title">{editingTask ? 'Edit Task' : 'Add Task'}</h2>
            <button className="btn-icon" onClick={() => setIsTaskModalOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSaveTask} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div className="form-group">
              <label htmlFor="task-title-input">Task</label>
              <input 
                id="task-title-input"
                type="text" 
                className="form-control" 
                value={taskTitle} 
                onChange={e => handleTitleChange(e.target.value)} 
                placeholder="What needs doing?"
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="task-desc-input">Notes (optional)</label>
              <textarea 
                id="task-desc-input"
                className="form-control" 
                value={taskDesc} 
                onChange={e => setTaskDesc(e.target.value)} 
                placeholder="Details..."
                rows={2}
              />
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label htmlFor="task-points-select">Size</label>
                <select 
                  id="task-points-select"
                  className="form-control"
                  value={taskDelegated ? 1 : taskPoints}
                  onChange={e => setTaskPoints(Number(e.target.value) as any)}
                  disabled={taskDelegated}
                >
                  <option value={1}>1 pt — Quick (&lt;30m)</option>
                  <option value={2}>2 pts — Minor (1-2h)</option>
                  <option value={3}>3 pts — Focus block</option>
                  <option value={5}>5 pts — Full day</option>
                  <option value={8}>8 pts — Epic (split!)</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="task-week-select">Target Week</label>
                <select 
                  id="task-week-select"
                  className="form-control"
                  value={taskWeek}
                  onChange={e => setTaskWeek(e.target.value)}
                >
                  <option value={currentWeek}>This Week</option>
                  <option value={getOffsetWeekFromNow(1)}>Next Week</option>
                  <option value={getOffsetWeekFromNow(2)}>Later (2 Weeks)</option>
                  <option value={getOffsetWeekFromNow(3)}>Later (3 Weeks)</option>
                  <option value={getOffsetWeekFromNow(4)}>Later (4 Weeks)</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem', margin: '0.2rem 0' }}>
              <input 
                id="task-today-checkbox"
                type="checkbox"
                checked={taskToday}
                onChange={e => setTaskToday(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <label htmlFor="task-today-checkbox" style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', userSelect: 'none' }}>
                ⭐ Schedule for Today's Focus List
              </label>
            </div>

            <div className="form-group">
              <label htmlFor="task-requested-by">For (optional)</label>
              <input 
                id="task-requested-by"
                type="text" 
                className="form-control" 
                value={taskRequestedBy} 
                onChange={e => setTaskRequestedBy(e.target.value)} 
                placeholder="Sarah, Alex…"
                list="people-suggestions"
              />
              <datalist id="people-suggestions">
                {people.map(p => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </div>

            {taskRequestedBy.trim() !== '' && (
              <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem', margin: '0.2rem 0' }}>
                <input 
                  id="task-delegate-checkbox"
                  type="checkbox"
                  checked={taskDelegated}
                  onChange={e => setTaskDelegated(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label htmlFor="task-delegate-checkbox" style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', userSelect: 'none' }}>
                  🤝 Assign to this person (Delegate task and reduce size to 1 pt)
                </label>
              </div>
            )}

            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => setIsTaskModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Save
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

            <div className="form-grid-2">
              <div className="form-group">
                <label htmlFor="settings-limit">Weekly Points Limit</label>
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

              <div className="form-group">
                <label htmlFor="settings-daily-limit">Daily Points Limit</label>
                <input 
                  id="settings-daily-limit"
                  type="number" 
                  className="form-control" 
                  value={settings.dailyPointsLimit || 7}
                  onChange={e => setSettings({ ...settings, dailyPointsLimit: Number(e.target.value) })}
                  min={1}
                  max={30}
                  required
                />
              </div>
            </div>

            <div className="form-group" style={{ marginTop: '0.8rem' }}>
              <label htmlFor="settings-triage-prompt">AI Triage Instructions (Triage System Prompt)</label>
              <textarea 
                id="settings-triage-prompt"
                className="form-control" 
                rows={3}
                value={settings.customTriagePrompt || ''}
                onChange={e => setSettings({ ...settings, customTriagePrompt: e.target.value })}
                placeholder="e.g. Prioritize coding tasks. Health items must always go to Focus Today. Size admin tasks as 1 point."
                style={{ fontFamily: 'var(--font-sans)', fontSize: '0.82rem', resize: 'vertical', minHeight: '80px' }}
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



      {/* Undo Toast */}
      {showUndoToast && deletedTaskBackup && (
        <div 
          className="glass-elevated animate-fade-in" 
          style={{ 
            position: 'fixed', 
            bottom: '5rem',
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
            borderRadius: 'var(--radius-md)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: '0.82rem', color: '#6d6528', fontWeight: 500 }}>
            Deleted: "<strong>{deletedTaskBackup.title}</strong>"
          </span>
          <button 
            type="button"
            onClick={handleUndoDelete}
            className="btn-primary"
            style={{ 
              padding: '0.3rem 0.7rem', 
              fontSize: '0.8rem', 
              margin: 0, 
              minHeight: '36px',
            }}
          >
            Undo
          </button>
        </div>
      )}

      {/* AI Action Toast Stack */}
      <div style={{
        position: 'fixed',
        bottom: '1.5rem',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9998,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        alignItems: 'center',
        pointerEvents: 'none',
      }}>
        {toasts.map(toast => (
          <div
            key={toast.id}
            className="animate-fade-in"
            style={{
              background: '#fdfcf7',
              border: '1px solid var(--border-color)',
              borderBottom: '2px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '0.5rem 1rem',
              fontSize: '0.82rem',
              color: 'var(--text-primary)',
              fontWeight: 500,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              whiteSpace: 'nowrap',
            }}
          >
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}
