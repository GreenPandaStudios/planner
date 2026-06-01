# Apple Minimal Design Token Guide

This guide outlines the design principles, color values, typography, and component structures implemented to achieve a calm, clean, iOS-inspired interface for FocusBoundary.

---

## 1. Design Principles

*   **Content Over Chrome:** Interface elements are minimal. Content (tasks, weekly capacity) stands out without visual distractions like dot patterns, grid lines, or heavy borders.
*   **Intentional Visual Hierarchy:** Weight differences (regular, medium, semibold) and neutral contrast guide focus naturally.
*   **Calm & Focused Palette:** Utilizes Apple-like neutral light backgrounds (`#f5f5f7`), pure white cards (`#ffffff`), and thin border separation (`#e5e5e7`).
*   **Purposeful Icons:** Avoids wordy button text. Instead, clean, familiar icons (`Plus`, `Trash2`, `Star`, `Play`, `SettingsIcon`, `TrendingUp`) represent actions.
*   **iOS-like Touch Target Density:** Minimum touch target sizes of 44px for easy mobile manipulation, with soft, rounded corners (`12px` and `20px`).

---

## 2. Global CSS Design Tokens

The following design tokens are configured in `src/index.css`:

```css
:root {
  /* Color Palette */
  --bg-base: #f5f5f7;        /* Calming iOS system gray background */
  --bg-surface: #ffffff;     /* Pure white card and sheet background */
  --border-color: #e5e5e7;   /* Apple hairline light border separation */
  --border-hover: #d2d2d7;   
  
  --text-primary: #1d1d1f;   /* Pitch gray-black for primary headers */
  --text-secondary: #86868b; /* Secondary neutral gray for descriptions */
  --text-muted: #a1a1a6;     /* Shaded neutral gray for hints */
  
  /* System Accents */
  --accent-primary: #0071e3; /* iOS Blue */
  --accent-cyan: #30b0c7;    /* Teal */
  --accent-purple: #af52de;  /* Violet */
  
  /* Status Colors */
  --color-success: #34c759;  /* Green */
  --color-warning: #ff9500;  /* Orange */
  --color-danger: #ff3b30;   /* Red */

  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* Corner Radii */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 20px;          /* Soft card corners matching iOS widgets */

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.02);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 10px 30px rgba(0, 0, 0, 0.06);
}
```

---

## 3. Key Components Refactored

### 3.1 iOS Segmented Context Switcher
Replaced standard tabs with a fluid, containerized segmented control:
*   A rounded gray wrapper (`rgba(120, 120, 128, 0.06)`) holding tab pills.
*   The active segment features a white background with a soft card shadow (`box-shadow: 0 1px 3px rgba(0,0,0,0.08)`).
*   Inactive segments are transparent and blend into the control.

### 3.2 Quick Capture Input Bar
Refactored the bulky Quick Add card to match the sleek appearance of Apple's Spotlight search:
*   Fluid, rounded capsule (`border-radius: var(--radius-md)`).
*   Solid light gray background, shifting smoothly to pure white with a soft blue halo on active focus.
*   Action button simplified to a single circular `Plus` icon, keeping text labels hidden.

### 3.3 Task Cards & Checkboxes
*   Checkboxes are designed as custom circular rings. Checking a task fills the circle with the accent blue and renders a crisp white checkmark.
*   Points indicator is rendered as a clean, rounded light pill (`3` or `5`) instead of a circled graphite border.
*   Action buttons at the bottom of task cards are simplified to clean icon buttons (`Star`, `Play`, `Trash2`), reducing visual noise.

### 3.4 Collapsed Advanced Settings
Uncluttered the settings form by moving parameters like Gist IDs, daily limit values, and AI instruction textareas to a collapsible details block. Only the essential connection keys and weekly capacity bounds are visible by default.
