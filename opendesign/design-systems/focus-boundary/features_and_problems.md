# FocusBoundary: Features & Problem-Solving Matrix

FocusBoundary is designed around the principles of **burnout prevention, attention protection, and lightweight workspace interactions**. Below is a detailed mapping of the application's core features to the specific productivity and mental-load problems they solve.

---

## 1. Attention-Based Point Budgeting
*   **The Feature:** Tasks are sized by attention effort, not just hours (1 pt = admin, 2 pt = minor, 3 pt = focus block, 5 pt = substantial, 8 pt = epic). The app enforces a hard budget (e.g., max 7 pts/day, 30 pts/week).
*   **The Problem It Solves:** *Overcommitment & Burnout.* Standard to-do lists treat all items equally, leading users to schedule ten heavy cognitive tasks in a single day. Point-budgeting acts as a capacity shield, forcing users to acknowledge physical limits and treat their attention as a finite resource.

## 2. Non-Blocking AI Capacity Negotiator
*   **The Feature:** When a task is added or resized that exceeds the weekly points budget, a slide-out sidebar drawer activates. The assistant negotiates shunting, resizing, or deleting tasks to fit the limit without locking the screen.
*   **The Problem It Solves:** *Planning Friction & Gridlock.* Enforcing hard limits normally locks the user out of saving, causing frustration. By running as a non-blocking assistant, the user can continue typing, rearranging, and dragging cards while negotiating compromises with the coach in the background.

## 3. Embedded Inline Active Focus Widget
*   **The Feature:** Focus Mode is embedded directly into the main view below the context tabs. It features an inline Pomodoro progress ring showing elapsed time, and controllers to Pause, Resume, or complete the active task.
*   **The Problem It Solves:** *Context-Switching Overhead.* Forcing users to open external Pomodoro apps or overlaying full-screen blockers separates the planning workspace from the focus state. Embedding the focus timer inline keeps the user grounded in their schedule while providing zero-clutter focus feedback.

## 4. Segmented Context Switcher (Work / Personal)
*   **The Feature:** A clean segmented control pill filters the schedule horizons to display only "Work" or "Personal" tasks. Unclassified tasks default to the active context when captured.
*   **The Problem It Solves:** *Cognitive Pollution.* Viewing personal errands (e.g., groceries) during focus work, or work deadlines during leisure time, creates chronic background stress. Switcher separation keeps mental boundaries sharp.

## 5. Domain Swiping Gestures
*   **The Feature:** Swiping a task card left on touch screens (or click-dragging on desktop) instantly classifies it as "Work" (color-coded blue edge); swiping right classifies it as "Personal" (color-coded green edge).
*   **The Problem It Solves:** *Form Friction.* Opening modal edit dialogs and clicking through select dropdowns to categorize tasks slows down planning. Direct manipulation gestures make sorting immediate and playful.

## 6. Startup Quick Capture Auto-Focus
*   **The Feature:** Upon opening the app or finishing onboarding, the text cursor automatically focuses inside the quick-add bar, immediately popping up the virtual keyboard on mobile.
*   **The Problem It Solves:** *Fast-Capture Friction.* In planners, the time it takes to tap a button, open a modal, and select fields creates a barrier to capturing thoughts. Auto-focus allows users to instantly dump tasks from short-term memory modal-free.

## 7. Private GitHub Gist Database Sync
*   **The Feature:** Tasks are synchronized directly to a private GitHub Gist owned by the user, authenticated via personal access tokens.
*   **The Problem It Solves:** *Data Ownership & Privacy Concerns.* Users are reluctant to store private professional or personal schedules on centralized third-party servers. Direct Gist syncing ensures complete client-side data ownership with zero intermediate servers.

## 8. Stale-While-Revalidate Offline Service Worker
*   **The Feature:** An offline PWA service worker caches all static assets, HTML, and libraries, allowing full standalone app launches offline, queueing sync pushes until internet access resumes.
*   **The Problem It Solves:** *Spotty Connections.* Traditional web-based planners crash or fail to save when the user is in transit, offline, or has a weak signal. PWA support ensures the planner is as reliable as physical paper.

## 9. Automated Delegation & Follow-Ups
*   **The Feature:** Marking a task as delegated to an assignee automatically shrinks the user's point allocation to 1 (representing admin oversight) and generates a new follow-up task (`Follow up with [Assignee] on: [Title]`) at the previous target date.
*   **The Problem It Solves:** *Follow-Up Memory Leak.* Delegating a task usually leaves it in the user's budget (eating capacity) or drops it entirely, leading to forgotten deliverables. Automated follow-ups ensure the loop is closed while freeing up focus space.
