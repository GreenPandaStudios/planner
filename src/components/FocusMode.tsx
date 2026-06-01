import { useState, useEffect, useRef } from 'react';
import type { Task } from '../types';

interface FocusModeProps {
  task: Task;
  onDone: (taskId: string) => void;
  onExit: () => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function FocusMode({ task, onDone, onExit }: FocusModeProps) {
  const [elapsed, setElapsed] = useState(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Acquire wake lock so screen stays on
  useEffect(() => {
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        }
      } catch { /* silently ignore — not all browsers support it */ }
    };
    acquire();

    // Re-acquire if tab becomes visible again
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      wakeLockRef.current?.release().catch(() => {});
    };
  }, []);

  // Elapsed timer
  useEffect(() => {
    intervalRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleDone = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    wakeLockRef.current?.release().catch(() => {});
    onDone(task.id);
  };

  const handleExit = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    wakeLockRef.current?.release().catch(() => {});
    onExit();
  };

  // Soft pulsing progress ring — just visual, loops every 25 min (one Pomodoro)
  const pomodoroCycle = 25 * 60;
  const ringProgress = (elapsed % pomodoroCycle) / pomodoroCycle;
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - ringProgress);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'linear-gradient(135deg, #f5f0e8 0%, #ede8dc 50%, #e8e0d0 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2.5rem',
        padding: '2rem',
        fontFamily: 'var(--font-sans, system-ui)',
        userSelect: 'none',
      }}
    >
      {/* Exit button — subtle, top-left */}
      <button
        onClick={handleExit}
        style={{
          position: 'absolute',
          top: '1.2rem',
          left: '1.2rem',
          background: 'transparent',
          border: 'none',
          color: 'rgba(0,0,0,0.25)',
          fontSize: '0.78rem',
          cursor: 'pointer',
          letterSpacing: '0.05em',
          fontFamily: 'var(--font-sans)',
          padding: '0.5rem',
        }}
      >
        ← back
      </button>

      {/* Project tag */}
      {task.parentProject && (
        <div style={{
          fontSize: '0.72rem',
          color: 'rgba(0,0,0,0.35)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
        }}>
          🔗 {task.parentProject}
        </div>
      )}

      {/* Pulsing ring + timer */}
      <div style={{ position: 'relative', width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg
          width={200}
          height={200}
          style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}
        >
          {/* Track */}
          <circle
            cx={100} cy={100} r={radius}
            fill="none"
            stroke="rgba(0,0,0,0.06)"
            strokeWidth={6}
          />
          {/* Progress */}
          <circle
            cx={100} cy={100} r={radius}
            fill="none"
            stroke="rgba(29,78,216,0.3)"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </svg>

        {/* Timer */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '2.6rem',
            fontWeight: 700,
            color: 'rgba(0,0,0,0.7)',
            letterSpacing: '-0.02em',
            lineHeight: 1,
          }}>
            {formatTime(elapsed)}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'rgba(0,0,0,0.3)', marginTop: '0.3rem', letterSpacing: '0.06em' }}>
            ELAPSED
          </div>
        </div>
      </div>

      {/* Task name */}
      <div style={{ textAlign: 'center', maxWidth: '80vw' }}>
        <div style={{
          fontSize: 'clamp(1.4rem, 5vw, 2rem)',
          fontFamily: 'var(--font-serif, Georgia)',
          fontWeight: 700,
          color: 'rgba(0,0,0,0.75)',
          lineHeight: 1.25,
          marginBottom: '0.4rem',
        }}>
          {task.title}
        </div>
        {task.description && (
          <div style={{ fontSize: '0.9rem', color: 'rgba(0,0,0,0.4)', lineHeight: 1.5 }}>
            {task.description}
          </div>
        )}
      </div>

      {/* Done button */}
      <button
        onClick={handleDone}
        style={{
          background: 'rgba(29,78,216,0.9)',
          color: '#fff',
          border: 'none',
          borderRadius: '100px',
          padding: '1rem 3rem',
          fontSize: '1rem',
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          letterSpacing: '0.02em',
          boxShadow: '0 4px 20px rgba(29,78,216,0.25)',
          minHeight: '56px',
          transition: 'transform 0.1s ease, box-shadow 0.1s ease',
        }}
        onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
        onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        ✓ Done
      </button>

      {/* Calming footnote */}
      <div style={{ fontSize: '0.72rem', color: 'rgba(0,0,0,0.2)', letterSpacing: '0.04em' }}>
        Stay here. One thing at a time.
      </div>
    </div>
  );
}
