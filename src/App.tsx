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
  Ban,
  Check,
  ArrowRight,
  ArrowLeft,
  Lock,
  Shield,
  Star,
  Play,
  TrendingUp,
  Sun,
  Inbox,
  Calendar,
  Clock,
  Briefcase,
  Home,
  Link2,
  Loader2,
  Target,
  Sparkles,
  Compass
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
import './App.css';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}


// Helper functions outside component to satisfy purity rules
function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function getTimestamp(): number {
  return Date.now();
}

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
  customTriagePrompt: '',
  userName: ''
};

export default function App() {
  // --- Core States ---
  const [tasks, setTasks] = useState<Task[]>(() => {
    let loadedTasks: Task[] = [];
    const saved = localStorage.getItem('antigravity_planner_tasks');
    if (saved) {
      try {
        loadedTasks = JSON.parse(saved);
      } catch (e) {
        console.error('Error loading tasks from localStorage', e);
      }
    }

    // New day load check: runs autoFillToday autopilot silently
    const todayStr = new Date().toDateString();
    const lastOpened = localStorage.getItem('antigravity_planner_last_opened_date');
    if (lastOpened !== todayStr) {
      const processedTasks = loadedTasks.map(t => {
        if (t.today) {
          if (t.status === 'done') {
            return { ...t, today: false };
          } else {
            return { ...t, carriedOver: true };
          }
        }
        return t;
      });

      const savedSettings = localStorage.getItem('antigravity_planner_settings');
      let dailyLimit = 7;
      if (savedSettings) {
        try {
          const parsed = JSON.parse(savedSettings);
          dailyLimit = parsed.dailyPointsLimit || 7;
        } catch (e) {
          console.error('Error parsing saved settings in lazy tasks initializer', e);
        }
      }
      const currentWeekStr = getIsoWeek(new Date());
      const updatedWithAutofill = autoFillToday(processedTasks, currentWeekStr, dailyLimit);
      localStorage.setItem('antigravity_planner_tasks', JSON.stringify(updatedWithAutofill));
      localStorage.setItem('antigravity_planner_last_opened_date', todayStr);
      return updatedWithAutofill;
    }

    return loadedTasks;
  });
  const [people, setPeople] = useState<Person[]>(() => {
    const saved = localStorage.getItem('antigravity_planner_people');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error loading people from localStorage', e);
      }
    }
    return [];
  });
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('antigravity_planner_settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return DEFAULT_SETTINGS;
      }
    }
    return DEFAULT_SETTINGS;
  });
  const [currentWeek] = useState<string>(() => getIsoWeek(new Date()));
  
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
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [isIOS] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
  });
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    const saved = localStorage.getItem('antigravity_planner_show_onboarding');
    return saved !== null ? JSON.parse(saved) : false;
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
    const id = generateId();
    setToasts(prev => [...prev, { id, text }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // --- Today's focus suggestion ---
  const [todaySuggestion, setTodaySuggestion] = useState<string | null>(null);
  // --- Focus Mode ---
  const [focusTask, setFocusTask] = useState<Task | null>(null);
  const [focusElapsed, setFocusElapsed] = useState(0);
  const [isFocusPaused, setIsFocusPaused] = useState(false);
  const [activeTab, setActiveTab] = useState<'focus' | 'backlog' | 'stats' | 'settings' | 'ai'>('focus');
  const [prevTab, setPrevTab] = useState<'focus' | 'backlog' | 'stats' | 'ai'>('focus');
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 768;
    }
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Focus Timer active hook
  useEffect(() => {
    if (!focusTask || isFocusPaused) return;
    const interval = setInterval(() => {
      setFocusElapsed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [focusTask, isFocusPaused]);

  // Start focus session helper
  const handleStartFocus = (task: Task) => {
    setFocusTask(task);
    setFocusElapsed(0);
    setIsFocusPaused(false);
    addToast(`▶ Started focus on: ${task.title}`);
    
    // Smooth scroll to top of app-container to view the focus widget
    const el = document.querySelector('.app-container');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const formatFocusTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleCompleteActiveFocus = () => {
    if (!focusTask) return;
    const taskId = focusTask.id;
    const updated = tasks.map(t => {
      if (t.id === taskId) {
        return { 
          ...t, 
          status: 'done' as const,
          completedAt: getTimestamp()
        };
      }
      return t;
    });
    saveTasksState(updated);
    addToast('✓ Completed focused task!');
    setFocusTask(null);
  };

  // --- Drag and Drop State ---
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [dragOverSection, setDragOverSection] = useState<'today' | 'week' | 'next-week' | 'later' | null>(null);

  // --- Swipe Domain Gesture State ---
  const [swipeTaskId, setSwipeTaskId] = useState<string | null>(null);
  const [swipeStartX, setSwipeStartX] = useState<number>(0);
  const [swipeStartY, setSwipeStartY] = useState<number>(0);
  const [swipeCurrentX, setSwipeCurrentX] = useState<number>(0);
  const [isSwipingHorizontal, setIsSwipingHorizontal] = useState<boolean>(false);

  // --- Setup Onboarding State ---
  const [showSetupOnboarding, setShowSetupOnboarding] = useState<boolean>(() => {
    const setupCompleted = localStorage.getItem('focus_boundary_setup_completed') === 'true';
    const savedSettings = localStorage.getItem('antigravity_planner_settings');
    let hasKeys = false;
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        if (parsed.githubPat || parsed.openaiApiKey) {
          hasKeys = true;
        }
      } catch (e) {
        console.error('Error parsing setup settings', e);
      }
    }
    return !hasKeys && !setupCompleted;
  });
  const [setupStep, setSetupStep] = useState<'welcome' | 'sync' | 'ai'>('welcome');
  const [tempUserName, setTempUserName] = useState(() => {
    const saved = localStorage.getItem('antigravity_planner_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.userName || '';
      } catch (e) {
        console.error('Error parsing setup userName', e);
      }
    }
    return '';
  });
  const [tempGithubPat, setTempGithubPat] = useState(() => {
    const saved = localStorage.getItem('antigravity_planner_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.githubPat || '';
      } catch (e) {
        console.error('Error parsing setup githubPat', e);
      }
    }
    return '';
  });
  const [tempOpenaiApiKey, setTempOpenaiApiKey] = useState(() => {
    const saved = localStorage.getItem('antigravity_planner_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.openaiApiKey || '';
      } catch (e) {
        console.error('Error parsing setup openaiApiKey', e);
      }
    }
    return '';
  });
  const [tempGistId, setTempGistId] = useState(() => {
    const saved = localStorage.getItem('antigravity_planner_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.gistId || '';
      } catch (e) {
        console.error('Error parsing setup gistId', e);
      }
    }
    return '';
  });
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // Native dialog refs
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  const taskDialogRef = useRef<HTMLDialogElement>(null);
  const quickCaptureInputRef = useRef<HTMLInputElement>(null);

  const triggerGistSyncPull = async (customSettings?: AppSettings) => {
    const activeSettings = customSettings || settings;
    if (!activeSettings.githubPat) return;
    setSyncStatus('syncing');
    try {
      let activeGistId = activeSettings.gistId;
      if (!activeGistId) {
        const foundId = await findExistingGist(activeSettings.githubPat);
        if (foundId) {
          activeGistId = foundId;
          const updatedSettings = { ...activeSettings, gistId: foundId };
          setSettings(updatedSettings);
          localStorage.setItem('antigravity_planner_settings', JSON.stringify(updatedSettings));
        } else {
          const newId = await createPrivateGist(activeSettings.githubPat, tasks, people);
          activeGistId = newId;
          const updatedSettings = { ...activeSettings, gistId: newId };
          setSettings(updatedSettings);
          localStorage.setItem('antigravity_planner_settings', JSON.stringify(updatedSettings));
        }
      }

      if (activeGistId) {
        const fetched = await fetchTasksFromGist(activeSettings.githubPat, activeGistId);
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

  const triggerGistSyncPush = async (tasksToPush: Task[], peopleToPush: Person[], customSettings?: AppSettings) => {
    const activeSettings = customSettings || settings;
    if (!activeSettings.githubPat || !activeSettings.gistId) return;
    setSyncStatus('syncing');
    try {
      await saveTasksToGist(activeSettings.githubPat, activeSettings.gistId, tasksToPush, peopleToPush);
      setSyncStatus('synced');
    } catch {
      setSyncStatus('error');
    }
  };

  const saveTasksState = (newTasks: Task[], shouldSyncPush = true) => {
    setTasks(newTasks);
    localStorage.setItem('antigravity_planner_tasks', JSON.stringify(newTasks));
    if (shouldSyncPush && settings.githubPat && settings.gistId) {
      triggerGistSyncPush(newTasks, people);
    }
  };

  // --- Initialization ---
  useEffect(() => {
    // Compute today suggestion silently on load
    if (settings.openaiApiKey) {
      getTodaySuggestion(tasks, currentWeek, settings.openaiApiKey)
        .then(suggestion => setTodaySuggestion(suggestion))
        .catch(e => console.error('Error getting today suggestion', e));
    }

    // Auto-focus quick-add input on startup if setup completed
    const setupCompleted = localStorage.getItem('focus_boundary_setup_completed') === 'true';
    const hasKeys = !!(settings.githubPat || settings.openaiApiKey);
    if (hasKeys || setupCompleted) {
      setTimeout(() => {
        quickCaptureInputRef.current?.focus();
      }, 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- PWA Install Prompt & iOS Support ---
  useEffect(() => {
    // Don't show if already installed (running in standalone)
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    if (isIOS) {
      const dismissed = localStorage.getItem('pwa_install_dismissed') === 'true';
      if (!dismissed) {
        const timer = setTimeout(() => {
          setShowInstallBanner(true);
        }, 3000);
        return () => clearTimeout(timer);
      }
    }

    const handler = (e: Event) => {
      const installEvent = e as BeforeInstallPromptEvent;
      installEvent.preventDefault();
      setInstallPrompt(installEvent);
      const dismissed = localStorage.getItem('pwa_install_dismissed') === 'true';
      if (!dismissed) {
        setShowInstallBanner(true);
      }
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [isIOS]);

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
      setTimeout(() => {
        triggerGistSyncPull();
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.githubPat, settings.gistId]);



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

  // --- Swipe Domain Gesture Handlers ---
  const handleTouchStart = (e: React.TouchEvent, taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task?.status === 'done') return;

    const touch = e.touches[0];
    setSwipeTaskId(taskId);
    setSwipeStartX(touch.clientX);
    setSwipeStartY(touch.clientY);
    setSwipeCurrentX(touch.clientX);
    setIsSwipingHorizontal(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swipeTaskId) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - swipeStartX;
    const deltaY = touch.clientY - swipeStartY;

    if (!isSwipingHorizontal) {
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        setIsSwipingHorizontal(true);
      } else if (Math.abs(deltaY) > 10) {
        setSwipeTaskId(null);
        return;
      }
    }

    if (isSwipingHorizontal) {
      if (e.cancelable) e.preventDefault();
      setSwipeCurrentX(touch.clientX);
    }
  };

  const handleTouchEnd = () => {
    if (!swipeTaskId) return;

    if (isSwipingHorizontal) {
      const deltaX = swipeCurrentX - swipeStartX;
      const swipeThreshold = 100; // swipe 100px to trigger change

      if (deltaX < -swipeThreshold) {
        handleMoveToDomain(swipeTaskId, 'work');
      } else if (deltaX > swipeThreshold) {
        handleMoveToDomain(swipeTaskId, 'personal');
      }
    }

    setSwipeTaskId(null);
    setIsSwipingHorizontal(false);
  };

  const handleMouseDown = (e: React.MouseEvent, taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task?.status === 'done') return;

    if ((e.target as HTMLElement).closest('button, input, select, textarea, label, span[style*="cursor: pointer"]')) return;
    if (e.button !== 0) return;

    setSwipeTaskId(taskId);
    setSwipeStartX(e.clientX);
    setSwipeStartY(e.clientY);
    setSwipeCurrentX(e.clientX);
    setIsSwipingHorizontal(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!swipeTaskId) return;
    const deltaX = e.clientX - swipeStartX;
    const deltaY = e.clientY - swipeStartY;

    if (!isSwipingHorizontal) {
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        setIsSwipingHorizontal(true);
      } else if (Math.abs(deltaY) > 10) {
        setSwipeTaskId(null);
        return;
      }
    }

    if (isSwipingHorizontal) {
      e.preventDefault();
      setSwipeCurrentX(e.clientX);
    }
  };

  const handleMouseUp = () => {
    handleTouchEnd();
  };

  const handleMoveToDomain = (taskId: string, targetDomain: 'work' | 'personal') => {
    setTasks(current => {
      const nextTasks = current.map(t => {
        if (t.id === taskId) {
          const currentMeta = t.metadata || {};
          return {
            ...t,
            metadata: {
              ...currentMeta,
              domain: targetDomain
            }
          };
        }
        return t;
      });
      localStorage.setItem('antigravity_planner_tasks', JSON.stringify(nextTasks));

      if (settings.githubPat && settings.gistId) {
        triggerGistSyncPush(nextTasks, people);
      }

      return nextTasks;
    });

    addToast(`✓ Moved to ${targetDomain === 'work' ? '💼 Work' : '🏠 Personal'}`);
  };

  // --- Onboarding Setup Handlers ---
  const handleValidateGithubPat = async () => {
    const pat = tempGithubPat.trim();
    if (!pat) {
      setSetupError('Please enter a GitHub personal access token.');
      return;
    }

    setIsValidating(true);
    setSetupError(null);

    try {
      const existingGistId = await findExistingGist(pat);
      if (existingGistId) {
        setTempGistId(existingGistId);
        addToast('✓ Found existing private Gist database.');
        try {
          const { tasks: pulledTasks, people: pulledPeople } = await fetchTasksFromGist(pat, existingGistId);
          if (pulledTasks.length > 0) {
            setTasks(pulledTasks);
            localStorage.setItem('antigravity_planner_tasks', JSON.stringify(pulledTasks));
          }
          if (pulledPeople.length > 0) {
            setPeople(pulledPeople);
            localStorage.setItem('antigravity_planner_people', JSON.stringify(pulledPeople));
          }
          addToast('✓ Pulled existing planner data.');
        } catch (e) {
          console.error('Failed to pull tasks from existing Gist', e);
        }
      } else {
        const newGistId = await createPrivateGist(pat, tasks, people);
        setTempGistId(newGistId);
        addToast('✓ Created new private Gist database.');
      }
      setSetupStep('ai');
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Validation failed. Check your token and Gist scopes.';
      setSetupError(msg);
    } finally {
      setIsValidating(false);
    }
  };

  const handleCompleteSetup = () => {
    const pat = tempGithubPat.trim();
    const apiKey = tempOpenaiApiKey.trim();
    const name = tempUserName.trim();

    const nextSettings: AppSettings = {
      ...settings,
      githubPat: pat,
      gistId: tempGistId,
      openaiApiKey: apiKey,
      userName: name,
    };

    setSettings(nextSettings);
    localStorage.setItem('antigravity_planner_settings', JSON.stringify(nextSettings));
    localStorage.setItem('focus_boundary_setup_completed', 'true');
    setShowSetupOnboarding(false);
    addToast('✓ Setup complete! Welcome to FocusBoundary.');

    if (pat && tempGistId) {
      triggerGistSyncPull(nextSettings);
    }

    // Auto-focus quick-add input to pop up the keyboard
    setTimeout(() => {
      quickCaptureInputRef.current?.focus();
    }, 100);
  };

  const handleSkipOnboarding = () => {
    const name = tempUserName.trim();
    const nextSettings: AppSettings = {
      ...settings,
      userName: name,
    };
    setSettings(nextSettings);
    localStorage.setItem('antigravity_planner_settings', JSON.stringify(nextSettings));
    localStorage.setItem('focus_boundary_setup_completed', 'true');
    setShowSetupOnboarding(false);
    addToast('ℹ Demo Mode activated (saves locally only).');

    // Auto-focus quick-add input to pop up the keyboard
    setTimeout(() => {
      quickCaptureInputRef.current?.focus();
    }, 100);
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

    const tempId = 'temp-' + generateId();
    
    // Quick heuristic parse to have a placeholder point size and target week
    const quickHeuristic = triageLocally(raw, currentWeek);
    
    const newTask: Task = {
      id: tempId,
      title: quickHeuristic.title,
      points: quickHeuristic.points,
      week: quickHeuristic.week || currentWeek,
      today: quickHeuristic.today || false,
      status: 'todo',
      createdAt: getTimestamp(),
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
        const np: Person = { id: generateId(), name: assignedRequester, createdAt: getTimestamp() };
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
              id: generateId(),
              title: s.title,
              points: s.points,
              week: s.week,
              status: 'todo' as const,
              createdAt: getTimestamp(),
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
      : { ...(editingTask?.metadata || parseTaskMetadataLocally(taskTitle, taskDesc)) };

    if (!localMeta.domain) {
      localMeta.domain = appMode;
    }

    // Delegation checks
    const wasDelegatedBefore = !!editingTask?.delegated;
    const delegatedToBefore = editingTask?.delegatedTo || '';
    const isNowDelegated = taskDelegated && !!cleanedName;
    const finalPoints = isNowDelegated ? 1 : taskPoints;

    const proposedTask: Task = {
      id: editingTask?.id || generateId(),
      title: taskTitle,
      description: taskDesc,
      points: finalPoints as 1 | 2 | 3 | 5 | 8,
      week: taskWeek,
      today: taskToday,
      status: (editingTask?.status || 'todo') as 'todo' | 'in-progress' | 'done',
      createdAt: editingTask?.createdAt || getTimestamp(),
      requestedBy: cleanedName || undefined,
      metadata: localMeta,
      delegated: isNowDelegated || undefined,
      delegatedTo: isNowDelegated ? cleanedName : undefined,
    };

    let followUpTask: Task | null = null;
    if (isNowDelegated && (!wasDelegatedBefore || delegatedToBefore !== cleanedName)) {
      followUpTask = {
        id: generateId(),
        title: `Follow up with ${cleanedName} on: ${taskTitle}`,
        description: `Follow up on delegated task: ${taskDesc || ''}`,
        points: 1,
        week: taskWeek,
        today: taskToday,
        status: 'todo',
        createdAt: getTimestamp(),
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
          id: generateId(),
          name: cleanedName,
          createdAt: getTimestamp()
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
          completedAt: nextStatus === 'done' ? getTimestamp() : undefined
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
    if (activeTab === 'settings') {
      setActiveTab(prevTab);
    }
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
        timestamp: getTimestamp(),
      }
    ]);
    
    setAgentRawHistory([
      {
        role: 'assistant',
        content: welcomeMsg
      }
    ]);
    
    setIsNegotiating(true);
    if (isMobile) {
      setPrevTab(activeTab === 'settings' ? prevTab : activeTab);
      setActiveTab('ai');
    }
  };

  const handleSendAgentMessage = async () => {
    if (!chatInput.trim() || !pendingTaskAction || !settings.openaiApiKey) return;

    const userText = chatInput;
    setChatInput('');

    const newUserMsg: AgentChatMessage = {
      id: generateId(),
      sender: 'user',
      text: userText,
      timestamp: getTimestamp(),
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
          id: generateId(),
          sender: 'agent',
          text: `⚙️ *Tool execution: Rescheduling task [ID: ${taskId}] to ${targetWeek}*`,
          timestamp: getTimestamp()
        }]);

        setTasks(prev => prev.map(t => {
          if (t.id === taskId) return { ...t, week: targetWeek, today: false };
          return t;
        }));
      },
      onDeleteTask: (taskId) => {
        setAgentMessages(prev => [...prev, {
          id: generateId(),
          sender: 'agent',
          text: `⚙️ *Tool execution: Deleting task [ID: ${taskId}]*`,
          timestamp: getTimestamp()
        }]);
        setTasks(prev => prev.filter(t => t.id !== taskId));
      },
      onUpdatePoints: (taskId, newPoints) => {
        if (taskId === 'new_task') {
          setAgentMessages(prev => [...prev, {
            id: generateId(),
            sender: 'agent',
            text: `⚙️ *Tool execution: Resizing pending task size to ${newPoints} points*`,
            timestamp: getTimestamp()
          }]);
          setPendingTaskAction(prev => {
            if (!prev) return null;
            return { ...prev, task: { ...prev.task, points: newPoints } };
          });
        } else {
          setAgentMessages(prev => [...prev, {
            id: generateId(),
            sender: 'agent',
            text: `⚙️ *Tool execution: Resizing task [ID: ${taskId}] to ${newPoints} points*`,
            timestamp: getTimestamp()
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
          id: generateId(),
          sender: 'agent',
          text: assistantTextMsg.content || '',
          timestamp: getTimestamp()
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
          if (activeTab === 'ai') {
            setActiveTab(prevTab);
          }
        }, 500);
      }
    } catch (err) {
      const error = err as Error;
      setAgentMessages(prev => [...prev, {
        id: generateId(),
        sender: 'agent',
        text: `⚠️ **Agent Error**: ${error.message || 'An error occurred during negotiation.'}`,
        timestamp: getTimestamp()
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
    if (activeTab === 'ai') {
      setActiveTab(prevTab);
    }
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
      createdAt: getTimestamp()
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
        timestamp: getTimestamp(),
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
        } catch {
          alert("Error parsing backup JSON file.");
        }
      };
    }
  };

  // --- Render calculations ---

  const weekPoints = getWeekPoints(currentWeek);
  const progressPercent = Math.min((weekPoints / settings.weeklyPointsLimit) * 100, 100);
  let progressBarColor = 'var(--accent-primary)';
  if (weekPoints > settings.weeklyPointsLimit) {
    progressBarColor = 'var(--color-danger)';
  } else if (weekPoints >= settings.weeklyPointsLimit * 0.85) {
    progressBarColor = 'var(--color-warning)';
  }

  const dailyHistory = getDailyCompletionHistory();
  const maxPts = Math.max(...dailyHistory.map(d => d.pts), 5);

  const modeFilteredTasks = tasks.filter(t => {
    // Hide completed tasks from previous days in current schedule view
    if (t.status === 'done' && t.completedAt) {
      const completedDate = new Date(t.completedAt).toDateString();
      const todayDate = new Date().toDateString();
      if (completedDate !== todayDate) {
        return false;
      }
    }

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
        id={`section-${sectionKey}`}
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
            {sectionKey === 'today' ? <Sun size={15} /> : sectionKey === 'week' ? <Inbox size={15} /> : sectionKey === 'next-week' ? <Calendar size={15} /> : <Clock size={15} />}
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
                <Target size={14} />
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
                gap: '0.35rem',
                borderColor: 'rgba(29, 78, 216, 0.3)',
                color: 'var(--accent-primary)',
                background: 'rgba(29, 78, 216, 0.02)'
              }}
            >
              <Sparkles size={13} /> Auto-Fill Today
            </button>
          </div>
        )}

        <div className="task-list">
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
                    <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
                    <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                      <span style={{ fontStyle: 'italic', color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 500 }}>
                        {task.title}
                      </span>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
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

            const isSwipingThis = swipeTaskId === task.id;
            const swipeOffset = isSwipingThis ? (swipeCurrentX - swipeStartX) : 0;

            return (
              <div 
                key={task.id} 
                className={`task-card ${task.status === 'done' ? 'completed' : ''} ${task.carriedOver ? 'carry-over' : ''} ${isDraggingThis ? 'dragging' : ''} ${isDragOverThis ? 'drag-over' : ''}`}
                draggable={task.status !== 'done' && !isSwipingHorizontal}
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
                onTouchStart={(e) => handleTouchStart(e, task.id)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onMouseDown={(e) => handleMouseDown(e, task.id)}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{ 
                  cursor: task.status === 'done' ? 'default' : (isSwipingHorizontal && isSwipingThis ? 'ew-resize' : 'grab'),
                  opacity: isDraggingThis ? 0.4 : (isSwipingThis ? Math.max(0.4, 1 - Math.abs(swipeOffset) / 300) : 1),
                  borderTop: isDragOverThis ? '3px solid var(--accent-primary)' : undefined,
                  transform: isSwipingThis && isSwipingHorizontal
                    ? `translateX(${swipeOffset}px) rotate(${swipeOffset * 0.03}deg)`
                    : (isDragOverThis ? 'translateY(2px)' : undefined),
                  transition: isSwipingThis ? 'none' : 'transform 0.2s ease, opacity 0.2s ease, background-color 0.2s ease, border-color 0.2s ease',
                  backgroundColor: isSwipingThis && isSwipingHorizontal
                    ? (swipeOffset < 0 ? '#f0f4ff' : '#f0fff4')
                    : undefined,
                  borderColor: isSwipingThis && isSwipingHorizontal
                    ? (swipeOffset < 0 ? 'var(--accent-primary)' : 'var(--color-success)')
                    : undefined,
                  position: 'relative'
                }}
              >
                {isSwipingThis && isSwipingHorizontal && Math.abs(swipeOffset) > 20 && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    [swipeOffset < 0 ? 'right' : 'left']: '12px',
                    background: swipeOffset < 0 ? 'var(--accent-primary)' : 'var(--color-success)',
                    color: '#fff',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    padding: '0.25rem 0.5rem',
                    borderRadius: 'var(--radius-sm)',
                    fontFamily: 'var(--font-sans)',
                    boxShadow: 'var(--shadow-sm)',
                    zIndex: 10,
                    pointerEvents: 'none',
                  }}>
                    {swipeOffset < 0 ? 'Move to Work' : 'Move to Personal'}
                  </div>
                )}
                {(task.parentProject || task.carriedOver) && (
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                    {task.parentProject && (
                      <div className="task-project-badge" style={{ marginBottom: 0 }}>
                        <Link2 size={11} />
                        <span>{task.parentProject}</span>
                      </div>
                    )}
                    {task.carriedOver && (
                      <div className="task-project-badge" style={{ marginBottom: 0, color: 'var(--color-warning)', background: 'rgba(255, 149, 0, 0.08)', border: '1px solid rgba(255, 149, 0, 0.15)' }}>
                        <Clock size={11} />
                        <span>Carry-over</span>
                      </div>
                    )}
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

                <div className="task-actions">
                  {task.status !== 'done' && (
                    <button
                      type="button"
                      className="task-card-icon-btn"
                      onClick={(e) => { e.stopPropagation(); handleToggleToday(task, e); }}
                      title={task.today ? "Remove from Today" : "Add to Today"}
                      style={{ color: task.today ? 'var(--color-warning)' : undefined }}
                    >
                      <Star size={14} fill={task.today ? 'var(--color-warning)' : 'none'} />
                    </button>
                  )}
                  {task.points >= 3 && task.status !== 'done' && (
                    <button
                      type="button"
                      className="task-card-icon-btn"
                      onClick={(e) => { e.stopPropagation(); handleStartFocus(task); }}
                      title="Start Focus Session"
                    >
                      <Play size={13} fill="currentColor" />
                    </button>
                  )}
                  {task.requestedBy && (
                    <span className="task-assignee">
                      <User size={11} style={{ color: 'var(--text-secondary)' }} /> {task.requestedBy}
                    </span>
                  )}
                  <button 
                    type="button"
                    className="task-card-icon-btn delete-btn" 
                    onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
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
            FocusBoundary
          </h1>
          <p className="brand-subtitle-greeting">Welcome back, {settings.userName || 'friend'}. Your focused day starts now.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
            <span className="brand-subtitle" style={{ margin: 0, fontSize: '0.74rem' }}>
              {getWeekPoints(currentWeek)}/{settings.weeklyPointsLimit} pts
            </span>
            <div style={{ width: '45px', height: '4px', background: 'rgba(0,0,0,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
              <div 
                style={{ 
                  width: `${progressPercent}%`, 
                  height: '100%', 
                  background: progressBarColor 
                }} 
              />
            </div>
          </div>
        </div>



        {/* Week Date Info */}
        <div className="week-navigator" style={{ pointerEvents: 'none' }}>
          <span className="current-week-label" style={{ fontWeight: 600 }}>
            {formatWeekRange(currentWeek)}
          </span>
        </div>

        <div className="header-actions" style={{ position: 'relative', display: 'flex', gap: '0.4rem' }}>
          <button 
            className="btn-icon" 
            onClick={() => setIsInsightsOpen(!isInsightsOpen)}
            title="Insights & Velocity"
            aria-label="Insights & Velocity"
            style={{ 
              background: isInsightsOpen ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
              borderColor: isInsightsOpen ? 'var(--accent-primary)' : 'var(--border-color)',
              color: isInsightsOpen ? 'var(--accent-primary)' : 'var(--text-secondary)'
            }}
          >
            <TrendingUp size={18} />
          </button>
          
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
            <span className="pwa-install-icon" style={{ display: 'inline-flex', alignItems: 'center' }}><Brain size={18} style={{ color: 'var(--accent-purple)' }} /></span>
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
                <span style={{ fontSize: '0.76rem' }}>Admin / Quick (&lt;30m)</span>
              </div>
              <div className="points-helper-col">
                <strong>2 pts</strong>
                <span style={{ fontSize: '0.76rem' }}>Minor task (1-2 hours)</span>
              </div>
              <div className="points-helper-col">
                <strong>3 pts</strong>
                <span style={{ fontSize: '0.76rem' }}>Focus block (2-4 hours)</span>
              </div>
              <div className="points-helper-col">
                <strong>5 pts</strong>
                <span style={{ fontSize: '0.76rem' }}>Substantial (half/full day)</span>
              </div>
              <div className="points-helper-col">
                <strong>8 pts</strong>
                <span style={{ fontSize: '0.76rem' }}>Complex Epic (split needed)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace Layout */}
      <div className={`main-content-layout ${isNegotiating && pendingTaskAction ? 'has-sidebar' : ''}`}>
        <div className="planner-main-panel" style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>

          {isMobile && activeTab === 'ai' ? (
            isNegotiating && pendingTaskAction ? (
              <div className="mobile-ai-coach-page animate-fade-in" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, height: 'calc(100dvh - 7.5rem)', gap: '1rem', padding: '0.8rem 1rem' }}>
                {/* Top Audit Banner */}
                <div className="agent-audit-header" style={{ borderRadius: 'var(--radius-md)', padding: '1rem', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
                  <div className="audit-header-top" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem' }}>
                    <div className="agent-avatar" style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent-purple)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem' }}>CA</div>
                    <div style={{ flexGrow: 1 }}>
                      <div className="agent-chat-title" style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>Capacity Assistant</div>
                      <div className="agent-chat-subtitle" style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Focus & Capacity Guardian</div>
                    </div>
                    <button 
                      type="button"
                      className="btn-abort-text"
                      onClick={handleCancelNegotiation}
                      title="Abort & Drop proposed task"
                      style={{ background: 'transparent', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', fontSize: '0.8rem', fontWeight: 600 }}
                    >
                      <Ban size={12} style={{ marginRight: '0.2rem' }} /> Abort
                    </button>
                  </div>

                  <div className="audit-header-stats" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <div className="audit-stat-item" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', fontWeight: 600 }}>
                        <span className="audit-stat-label" style={{ color: 'var(--text-secondary)' }}>Week {pendingTaskAction.task.week.replace(/^.*-W/, '')} Load</span>
                        <span className="audit-stat-value" style={{ color: 'var(--text-primary)' }}>{getWeekPoints(pendingTaskAction.task.week)}/{settings.weeklyPointsLimit} pts</span>
                      </div>
                      <div className="audit-progress-bar" style={{ height: '6px', background: 'rgba(0,0,0,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div 
                          className="audit-progress-fill" 
                          style={{ 
                            height: '100%',
                            width: `${Math.min((getWeekPoints(pendingTaskAction.task.week) / settings.weeklyPointsLimit) * 100, 100)}%`,
                            backgroundColor: getWeekPoints(pendingTaskAction.task.week) > settings.weeklyPointsLimit ? 'var(--color-danger)' : 'var(--accent-purple)',
                            borderRadius: '3px'
                          }}
                        />
                      </div>
                    </div>

                    <div className="audit-proposed-item" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.6rem', marginTop: '0.2rem' }}>
                      <span className="audit-stat-label" style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 500 }}>Proposed Task</span>
                      <div className="audit-proposed-details" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.15rem' }}>
                        <span className="audit-proposed-title" style={{ fontSize: '0.88rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '0.5rem' }} title={pendingTaskAction.task.title}>
                          {pendingTaskAction.task.title}
                        </span>
                        <span className="audit-proposed-points" style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-primary)', background: 'rgba(0,113,227,0.08)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>+{pendingTaskAction.task.points} pts</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Conversational Chat Panel */}
                <div className="agent-chat-panel" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-surface-solid)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
                  <div className="chat-message-list" style={{ flexGrow: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem', minHeight: '180px' }}>
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

                  <div className="chat-input-bar" style={{ padding: '0.6rem 0.8rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '0.5rem', background: 'var(--bg-surface-elevated)' }}>
                    <input 
                      type="text" 
                      className="chat-input"
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSendAgentMessage()}
                      placeholder="Propose a compromise..."
                      disabled={isAgentTyping}
                      style={{ flexGrow: 1, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.75rem', outline: 'none', background: 'var(--bg-surface-solid)', fontSize: '0.92rem' }}
                      autoFocus
                    />
                    <button 
                      type="button"
                      className="chat-send-btn" 
                      onClick={handleSendAgentMessage}
                      disabled={isAgentTyping || !chatInput.trim()}
                      style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--accent-primary)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                    >
                      <Send size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mobile-ai-coach-page animate-fade-in" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, height: 'calc(100dvh - 12rem)', gap: '1rem', padding: '2rem 1.5rem', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                <Brain size={48} style={{ color: 'var(--accent-purple)', marginBottom: '0.5rem' }} />
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Capacity Coach</h2>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', maxWidth: '280px', lineHeight: 1.5 }}>
                  Speak with your Coach to audit commitments, rebalance story points, or find alternatives.
                </p>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={triggerManualNegotiation}
                  style={{ marginTop: '0.8rem', padding: '0.6rem 1.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <Sparkles size={14} /> Start Capacity Review
                </button>
              </div>
            )
          ) : (
            <>
              {/* Quick Capture Input Form */}
              <form onSubmit={handleQuickAdd} className="quick-capture-form animate-fade-in">
                <input 
                  type="text" 
                  className="quick-capture-input" 
                  placeholder="Add a task — FocusBoundary will schedule it"
                  ref={quickCaptureInputRef}
                  autoFocus={true}
                  value={quickTaskTitle}
                  onChange={e => setQuickTaskTitle(e.target.value)}
                />
                <button 
                  type="submit" 
                  className="quick-capture-submit" 
                  disabled={!quickTaskTitle.trim()}
                  title="Add Task"
                >
                  <Plus size={16} />
                </button>
              </form>

              {/* Excess Capacity Alert Banner */}
              {(getTodayPoints() > (settings.dailyPointsLimit || 7) || getWeekPoints(currentWeek) > settings.weeklyPointsLimit) && (
                <div className="glass-elevated animate-fade-in" style={{
                  background: 'rgba(255, 59, 48, 0.08)',
                  border: '1px solid rgba(255, 59, 48, 0.15)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.6rem 1rem',
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  fontSize: '0.82rem',
                  color: 'var(--color-danger)',
                  fontWeight: 600
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <AlertTriangle size={14} />
                    <span>
                      {getWeekPoints(currentWeek) > settings.weeklyPointsLimit && getTodayPoints() > (settings.dailyPointsLimit || 7)
                        ? `Daily limit exceeded (${getTodayPoints()}/${settings.dailyPointsLimit || 7} pts) & Weekly limit exceeded (${getWeekPoints(currentWeek)}/${settings.weeklyPointsLimit} pts)!`
                        : getWeekPoints(currentWeek) > settings.weeklyPointsLimit
                        ? `Weekly load limit exceeded (${getWeekPoints(currentWeek)}/${settings.weeklyPointsLimit} pts)!`
                        : `Daily focus limit exceeded (${getTodayPoints()}/${settings.dailyPointsLimit || 7} pts)!`}
                    </span>
                  </div>
                  {settings.openaiApiKey && (
                    <button 
                      type="button" 
                      onClick={handleTriggerManualTriage}
                      style={{
                        border: 'none',
                        background: 'var(--color-danger)',
                        color: '#fff',
                        padding: '0.3rem 0.6rem',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'opacity 0.15s ease'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                      onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                    >
                      Auto-Triage
                    </button>
                  )}
                </div>
              )}

              {/* Insights & Trends Card */}
              {((isMobile && activeTab === 'stats') || (!isMobile && isInsightsOpen)) && (
                <div className="capacity-card glass animate-fade-in" style={{ marginBottom: '1.2rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem', fontFamily: 'var(--font-sans)', color: 'var(--text-secondary)' }}>
                      <TrendingUp size={15} /> Daily Velocity & Insights
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.2rem' }}>
                    
                    {/* Stats Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.8rem', textAlign: 'center' }}>
                      <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.5rem' }}>
                        <div style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                          {getVelocityStats().streak} days
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>Active Streak</div>
                      </div>
                      <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.5rem' }}>
                        <div style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                          {getVelocityStats().averageDaily}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>Avg Pts/Day</div>
                      </div>
                      <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.5rem' }}>
                        <div style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                          {getVelocityStats().totalPoints}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>Total Pts</div>
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
                                <span style={{ fontSize: '0.74rem', fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: '0.2rem' }}>
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
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                {item.date}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* Work / Personal Context Switcher */}
              <div className="segmented-control">
                <button
                  type="button"
                  className={`segment-item ${appMode === 'work' ? 'active' : ''}`}
                  onClick={() => handleSetAppMode('work')}
                >
                  <Briefcase size={14} /> Work
                </button>
                <button
                  type="button"
                  className={`segment-item ${appMode === 'personal' ? 'active' : ''}`}
                  onClick={() => handleSetAppMode('personal')}
                >
                  <Home size={14} /> Personal
                </button>
              </div>

              {/* Active Focus Card (Matches modern_apple_mockup) */}
              {focusTask && (!isMobile || activeTab === 'focus') && (
                <div className="capacity-card glass animate-fade-in" style={{ marginBottom: '1.2rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, fontFamily: 'var(--font-sans)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Active Focus
                    </span>
                    <button 
                      type="button"
                      onClick={() => setFocusTask(null)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 500 }}
                    >
                      Exit
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '1rem', marginTop: '0.2rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>Deep Work</span>
                      <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={focusTask.title}>
                        {focusTask.title}
                      </span>
                    </div>

                    {/* Progress timer circle */}
                    <div style={{ position: 'relative', width: '60px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="60" height="60" style={{ transform: 'rotate(-90deg)', position: 'absolute' }}>
                        <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(0,0,0,0.03)" strokeWidth="2.5" />
                        <circle 
                          cx="30" cy="30" r="26" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" 
                          strokeDasharray={163.36}
                          strokeDashoffset={163.36 * (1 - (focusElapsed % 1500) / 1500)}
                          strokeLinecap="round"
                          style={{ transition: 'stroke-dashoffset 1s linear' }}
                        />
                      </svg>
                      <span style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {formatFocusTime(focusElapsed)}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: 1, gap: '0.2rem' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>Mode</span>
                      <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.1rem' }}>
                        <button 
                          type="button"
                          className="btn-secondary" 
                          onClick={() => setIsFocusPaused(!isFocusPaused)}
                          style={{ padding: '0.3rem 0.6rem', minHeight: '30px', fontSize: '0.76rem', borderRadius: 'var(--radius-sm)' }}
                        >
                          {isFocusPaused ? 'Resume' : 'Pause'}
                        </button>
                        <button 
                          type="button"
                          className="btn-primary" 
                          onClick={handleCompleteActiveFocus}
                          style={{ padding: '0.3rem 0.6rem', minHeight: '30px', fontSize: '0.76rem', borderRadius: 'var(--radius-sm)' }}
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '0.1rem' }}>
                    Focusing...
                  </div>
                </div>
              )}

              {/* Stacked Horizons Sections */}
              <main className="columns-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', padding: 0 }}>
                {(!isMobile || activeTab === 'focus') && renderTaskSectionList('Focus Today', 'today', modeFilteredTasks.filter(t => t.week === currentWeek && t.today), settings.dailyPointsLimit || 7)}
                {(!isMobile || activeTab === 'backlog') && (
                  <>
                    {renderTaskSectionList("This Week's Backlog", 'week', modeFilteredTasks.filter(t => t.week === currentWeek && !t.today), settings.weeklyPointsLimit)}
                    {renderTaskSectionList('Next Week', 'next-week', modeFilteredTasks.filter(t => t.week === getOffsetWeekFromNow(1)))}
                    {renderTaskSectionList('Later', 'later', modeFilteredTasks.filter(t => t.week > getOffsetWeekFromNow(1)))}
                  </>
                )}
              </main>
            </>
          )}
        </div>

        {/* Capacity Negotiator Sidebar Drawer */}
        {!isMobile && isNegotiating && pendingTaskAction && (
          <aside className="agent-sidebar-drawer glass-elevated">
            
            {/* Top Audit Banner */}
            <div className="agent-audit-header">
              <div className="audit-header-top">
                <div className="agent-avatar">CA</div>
                <div style={{ flexGrow: 1 }}>
                  <div className="agent-chat-title">Capacity Assistant</div>
                  <div className="agent-chat-subtitle">Focus & Capacity Guardian</div>
                </div>
                <button 
                  type="button"
                  className="btn-abort-text"
                  onClick={handleCancelNegotiation}
                  title="Abort & Drop proposed task"
                >
                  <Ban size={11} style={{ marginRight: '0.2rem' }} /> Abort
                </button>
              </div>

              <div className="audit-header-stats">
                <div className="audit-stat-item">
                  <span className="audit-stat-label">Week {pendingTaskAction.task.week.replace(/^.*-W/, '')} Load</span>
                  <span className="audit-stat-value">{getWeekPoints(pendingTaskAction.task.week)}/{settings.weeklyPointsLimit} pts</span>
                  <div className="audit-progress-bar">
                    <div 
                      className="audit-progress-fill" 
                      style={{ 
                        width: `${Math.min((getWeekPoints(pendingTaskAction.task.week) / settings.weeklyPointsLimit) * 100, 100)}%`,
                        backgroundColor: getWeekPoints(pendingTaskAction.task.week) > settings.weeklyPointsLimit ? 'var(--color-danger)' : 'var(--accent-purple)'
                      }}
                    />
                  </div>
                </div>

                <div className="audit-proposed-item">
                  <span className="audit-stat-label">Proposed Task</span>
                  <div className="audit-proposed-details">
                    <span className="audit-proposed-title" title={pendingTaskAction.task.title}>
                      {pendingTaskAction.task.title}
                    </span>
                    <span className="audit-proposed-points">+{pendingTaskAction.task.points} pts</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Conversational Chat Panel */}
            <div className="agent-chat-panel">
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
                  onChange={e => setTaskPoints(Number(e.target.value) as 1 | 2 | 3 | 5 | 8)}
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
      <dialog 
        ref={settingsDialogRef} 
        onClose={() => {
          setIsSettingsOpen(false);
          if (activeTab === 'settings') {
            setActiveTab(prevTab);
          }
        }}
      >
        <div className="modal-content glass-elevated">
          <div className="modal-header">
            <h2 className="modal-title">Settings</h2>
            <button className="btn-icon" onClick={() => setIsSettingsOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group">
              <label htmlFor="settings-username" style={{ fontWeight: 600 }}>Your Name</label>
              <input 
                id="settings-username"
                type="text" 
                className="form-control" 
                value={settings.userName || ''}
                onChange={e => setSettings({ ...settings, userName: e.target.value })}
                placeholder="Enter your name"
              />
            </div>

            <div className="form-group">
              <label htmlFor="settings-openai-key" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
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
            </div>

            <div className="form-group">
              <label htmlFor="settings-github-pat" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
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
              <details style={{ marginTop: '0.3rem', fontSize: '0.72rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--accent-primary)', fontWeight: 500 }}>
                  Token Help
                </summary>
                <ol style={{ paddingLeft: '1.2rem', marginTop: '0.2rem', display: 'flex', flexDirection: 'column', gap: '0.2rem', color: 'var(--text-secondary)' }}>
                  <li>Go to Settings &gt; Developer settings &gt; Tokens (classic) on GitHub.</li>
                  <li>Generate classic token with <strong>gist</strong> scope.</li>
                  <li>Copy/paste token here.</li>
                </ol>
              </details>
            </div>

            <div className="form-group">
              <label htmlFor="settings-limit" style={{ fontWeight: 600 }}>Weekly Points Limit</label>
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

            <details style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.8rem', marginTop: '0.4rem' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.8rem' }}>
                Advanced Settings
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.8rem' }}>
                <div className="form-group">
                  <label htmlFor="settings-gist-id">Gist Database ID</label>
                  <input 
                    id="settings-gist-id"
                    type="text" 
                    className="form-control" 
                    value={settings.gistId}
                    onChange={e => setSettings({ ...settings, gistId: e.target.value })}
                    placeholder="Created automatically"
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

                <div className="form-group">
                  <label htmlFor="settings-triage-prompt">AI Triage Instructions</label>
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
              </div>
            </details>

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
          className="animate-fade-in" 
          style={{ 
            position: 'fixed', 
            bottom: '5rem',
            left: '50%', 
            transform: 'translateX(-50%)', 
            background: 'rgba(28, 28, 30, 0.95)', 
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '0.5rem 1.2rem', 
            zIndex: 10000, 
            display: 'flex', 
            alignItems: 'center', 
            gap: '1rem',
            borderRadius: '99px',
            whiteSpace: 'nowrap',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
          }}
        >
          <span style={{ fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.9)', fontWeight: 500 }}>
            Deleted "{deletedTaskBackup.title}"
          </span>
          <button 
            type="button"
            onClick={handleUndoDelete}
            style={{ 
              background: 'transparent',
              border: 'none',
              color: '#0A84FF',
              fontWeight: 600,
              fontSize: '0.82rem',
              cursor: 'pointer',
              padding: '0.2rem 0.5rem',
              margin: 0,
            }}
          >
            Undo
          </button>
        </div>
      )}

      {/* Setup Onboarding Overlay */}
      {showSetupOnboarding && (
        <div className="onboarding-setup-overlay">
          <div className="onboarding-setup-card glass-elevated">
            {/* Header / Brand */}
            <div className="onboarding-header">
              <span className="onboarding-brand">
                <Brain size={20} style={{ color: 'var(--accent-purple)' }} /> FocusBoundary
              </span>
              <div className="setup-pagination-dots">
                <span className={`dot ${setupStep === 'welcome' ? 'active' : ''}`} />
                <span className={`dot ${setupStep === 'sync' ? 'active' : ''}`} />
                <span className={`dot ${setupStep === 'ai' ? 'active' : ''}`} />
              </div>
            </div>

            {/* Step Content */}
            {setupStep === 'welcome' && (
              <div className="setup-step-content animate-fade-in">
                <h2 className="setup-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Shield size={22} className="icon-blue" style={{ flexShrink: 0 }} /> Protect Your Focus Boundary
                </h2>
                <p className="setup-subtitle">FocusBoundary is a calm, personal daily capacity planner designed to prevent burnout.</p>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label htmlFor="onboarding-username" style={{ fontWeight: 600, display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                    What is your name?
                  </label>
                  <input
                    id="onboarding-username"
                    type="text"
                    className="form-control"
                    placeholder="Enter your name (e.g., Alex)"
                    value={tempUserName}
                    onChange={e => setTempUserName(e.target.value)}
                    style={{ width: '100%', minHeight: '44px' }}
                  />
                </div>

                <div className="onboarding-guide-box">
                  <h3 className="guide-box-title">Core Principles</h3>
                  <ul className="guide-box-list">
                    <li>
                      <strong>Size with Story Points:</strong> Size your tasks from 1 to 8 based on effort rather than strict hours.
                    </li>
                    <li>
                      <strong>Respect Your Limits:</strong> A weekly capacity limit guards your focus and flags overcommitment.
                    </li>
                    <li>
                      <strong>AI Capacity Assistant:</strong> A friendly client-side coach helps negotiate task overloads.
                    </li>
                    <li>
                      <strong>100% Client-Side & Private:</strong> Your tokens and keys never leave your browser.
                    </li>
                  </ul>
                </div>

                <div className="setup-actions">
                  <button 
                    type="button" 
                    className="btn-primary btn-large"
                    onClick={() => setSetupStep('sync')}
                  >
                    Set Up Sync & AI <ArrowRight size={16} />
                  </button>
                  <button 
                    type="button" 
                    className="btn-link"
                    onClick={handleSkipOnboarding}
                  >
                    Or run in local-only demo mode
                  </button>
                </div>
              </div>
            )}

            {setupStep === 'sync' && (
              <div className="setup-step-content animate-fade-in">
                <h2 className="setup-title">Secure Device Sync</h2>
                <p className="setup-subtitle">Sync your tasks across your phone and computer using a private GitHub Gist as your database.</p>

                <div className="onboarding-guide-box">
                  <div className="guide-box-row">
                    <Globe size={18} className="icon-blue" style={{ flexShrink: 0 }} />
                    <div>
                      <strong>GitHub Personal Access Token (PAT)</strong>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Allows FocusBoundary to read and write your planner data securely. Stored only in this browser.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: '0.5rem' }}>
                  <label htmlFor="setup-github-pat" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
                    <Lock size={14} /> Enter GitHub PAT
                  </label>
                  <input 
                    id="setup-github-pat"
                    type="password" 
                    className="form-control" 
                    value={tempGithubPat}
                    onChange={e => {
                      setTempGithubPat(e.target.value);
                      setSetupError(null);
                    }}
                    placeholder="ghp_..."
                  />
                  
                  <details style={{ marginTop: '0.4rem', fontSize: '0.78rem' }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--accent-primary)', fontWeight: 600 }}>
                      How to generate a token in 30 seconds:
                    </summary>
                    <ol style={{ paddingLeft: '1.2rem', marginTop: '0.3rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', color: 'var(--text-secondary)' }}>
                      <li>Login to <strong>GitHub.com</strong>.</li>
                      <li>Go to <strong>Settings</strong> &gt; <strong>Developer settings</strong> &gt; <strong>Tokens (classic)</strong>.</li>
                      <li>Click <strong>Generate new token (classic)</strong>.</li>
                      <li>Select the <strong>gist</strong> checkbox scope.</li>
                      <li>Generate the token, copy it, and paste it here.</li>
                    </ol>
                  </details>
                </div>

                {setupError && (
                  <div className="sticky-warning" style={{ marginTop: '0.8rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: '0.78rem' }}>{setupError}</span>
                  </div>
                )}

                {tempGistId && (
                  <div className="setup-success-badge" style={{ marginTop: '0.8rem' }}>
                    <Check size={16} />
                    <span>Connected! Database ID: <code>{tempGistId.substring(0, 8)}...</code></span>
                  </div>
                )}

                <div className="setup-actions">
                  {!tempGistId ? (
                    <button 
                      type="button" 
                      className="btn-primary btn-large"
                      disabled={isValidating || !tempGithubPat.trim()}
                      onClick={handleValidateGithubPat}
                    >
                      {isValidating ? (
                        <>
                          <span className="spinner" /> Validating Token...
                        </>
                      ) : (
                        <>
                          Connect GitHub Token <Check size={16} />
                        </>
                      )}
                    </button>
                  ) : (
                    <button 
                      type="button" 
                      className="btn-primary btn-large"
                      onClick={() => setSetupStep('ai')}
                    >
                      Continue to AI Coach <ArrowRight size={16} />
                    </button>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginTop: '0.5rem' }}>
                    <button 
                      type="button" 
                      className="btn-secondary"
                      onClick={() => setSetupStep('welcome')}
                    >
                      <ArrowLeft size={14} /> Back
                    </button>
                    <button 
                      type="button" 
                      className="btn-link"
                      onClick={handleSkipOnboarding}
                    >
                      Skip to Local Demo Mode
                    </button>
                  </div>
                </div>
              </div>
            )}

            {setupStep === 'ai' && (
              <div className="setup-step-content animate-fade-in">
                <h2 className="setup-title">Enable AI Capacity Assistant</h2>
                <p className="setup-subtitle">Activate your client-side coach to negotiate task point sizes and auto-triage schedule overloads.</p>

                <div className="onboarding-guide-box">
                  <div className="guide-box-row">
                    <Key size={18} className="icon-purple" style={{ flexShrink: 0 }} />
                    <div>
                      <strong>OpenAI API Key</strong>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Powers the Capacity Negotiator assistant in the sidebar. Your key is stored locally and sent directly to OpenAI.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: '0.5rem' }}>
                  <label htmlFor="setup-openai-key" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
                    <Lock size={14} /> Enter OpenAI API Key (Optional)
                  </label>
                  <input 
                    id="setup-openai-key"
                    type="password" 
                    className="form-control" 
                    value={tempOpenaiApiKey}
                    onChange={e => setTempOpenaiApiKey(e.target.value)}
                    placeholder="sk-..."
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Leave blank to skip and set up later in Settings.
                  </span>
                </div>

                <div className="setup-actions">
                  <button 
                    type="button" 
                    className="btn-primary btn-large"
                    onClick={handleCompleteSetup}
                  >
                    Finish Setup & Start Planning <Check size={16} />
                  </button>

                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginTop: '0.5rem' }}>
                    <button 
                      type="button" 
                      className="btn-secondary"
                      onClick={() => setSetupStep('sync')}
                    >
                      <ArrowLeft size={14} /> Back
                    </button>
                    <button 
                      type="button" 
                      className="btn-link"
                      onClick={handleSkipOnboarding}
                    >
                      Skip to Local Demo Mode
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
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

      {/* Mobile Bottom Tab Bar (Matches modern_apple_mockup) */}
      <div className="mobile-tab-bar">
        <button 
          type="button"
          className={`tab-item ${activeTab === 'focus' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('focus');
            setPrevTab('focus');
            const el = document.getElementById('section-today');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          <Compass size={20} />
          <span>Focus</span>
        </button>
        <button 
          type="button"
          className={`tab-item ${activeTab === 'backlog' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('backlog');
            setPrevTab('backlog');
            const el = document.getElementById('section-week');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          <Calendar size={20} />
          <span>Backlog</span>
        </button>
        <button 
          type="button"
          className={`tab-item ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('stats');
            setPrevTab('stats');
            if (!isMobile) {
              setIsInsightsOpen(!isInsightsOpen);
              addToast(isInsightsOpen ? 'Collapsing insights stats' : 'Opening insights stats');
            }
          }}
        >
          <TrendingUp size={20} />
          <span>Stats</span>
        </button>
        <button 
          type="button"
          className={`tab-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => {
            setPrevTab(activeTab === 'settings' ? prevTab : activeTab);
            setActiveTab('settings');
            setIsSettingsOpen(true);
          }}
        >
          <SettingsIcon size={20} />
          <span>Settings</span>
        </button>
        <button 
          type="button"
          className={`tab-item ${activeTab === 'ai' ? 'active' : ''}`}
          onClick={() => {
            setPrevTab(activeTab === 'settings' ? prevTab : activeTab);
            setActiveTab('ai');
            triggerManualNegotiation();
          }}
        >
          <Brain size={20} />
          <span>AI Triage</span>
        </button>
      </div>
    </div>
  );
}
