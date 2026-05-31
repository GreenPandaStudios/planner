# FocusBoundary

FocusBoundary is a serene, offline-first personal velocity planner built with a clean physical diary aesthetic. It is designed to prevent burnout by enforcing weekly attention limits using story points instead of calendar hours.

## Key Features

### 📖 Serene Notebook Aesthetic
- **Warm Lined Paper View**: Designed with a paper-textured cream background, Google Serif typography (Lora), and graphite-sketch borders.
- **Mobile-First Layout**: Fully optimized for single-handed phone usage with touch-friendly inline tap zones and minimalist UI controls.

### ⚡ Focus Effort Sizing Model
Size tasks by attention/cognitive load rather than chronological hours:
- **1 pt** – XS (Quick admin, emails, minor chores; <30 mins)
- **2 pts** – S (Minor focus task; 1–2 hours)
- **3 pts** – M (Focus block; half-day, 2–4 hours)
- **5 pts** – L (Project task; full day focus)
- **8 pts** – XL (Complex epic; triggers warning to split the task)

### 🤖 Client-Side AI Capacity Negotiator
- **Automatic Parsers**: The quick-capture input at the top automatically extracts assignees (*"for Sarah"*), points (*"3 pts"*), and scheduled days (*"Monday"*), stripping text noise automatically.
- **Overload Negotiation**: If a task pushes you over your weekly capacity (defaulting to **30 points**), the **Capacity Assistant** launches. It contextually audits your commitments, identifies who is asking for your time, and guides you to reschedule, resize, or postpone tasks to protect your week.
- **Coaching Notes**: Quiet, helpful capacity advice contextually offered inside the assistant chat overlay.

### 📲 Offline-First & Automated Gist Sync
- **Progressive Web App (PWA)**: Implements a Stale-While-Revalidate caching Service Worker with SPA fallback support, making the app fully usable offline when added to a mobile home screen.
- **Network-Sensing Database Sync**: Automatically saves schedule changes locally to `localStorage` and synchronizes with your private GitHub Gists via personal access tokens (PAT). Sync triggers automatically as soon as the client transitions from offline to online.
- **High-Speed Inline Triage**: Tap a card's points badge to cycle sizes immediately (`1 -> 2 -> 3 -> 5 -> 8`), tap day initials (`[M] [T] [W] [Th] [F]`) to reschedule in one click, and delete tasks instantly with a 5-second recovery "Undo Toast" banner.

---

## Getting Started

### Development
1. Clone the repository:
   ```bash
   git clone git@github.com:GreenPandaStudios/planner.git
   cd planner
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```

### Production Build & Deployment
- Build for production:
   ```bash
   npm run build
   ```
- Deploy to GitHub Pages manually:
   ```bash
   npm run deploy
   ```
- **Automated Deployment**: A GitHub Actions workflow is configured under `.github/workflows/deploy.yml` to automatically build and host the app on GitHub Pages whenever code is pushed to `main`.

---

## Technology Stack
- **Framework**: React 19 + TypeScript + Vite
- **Styling**: Vanilla CSS with dark slate / notebook utility variables
- **Service Worker**: PWA caching shell client (`sw.js`)
- **Database**: GitHub Gist JSON synchronization + client `localStorage` fallback
- **Icons**: Lucide React
- **Logic Core**: Client-side OpenAI API Agent integration
