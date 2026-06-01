# Modern Apple Design Token Guide

This guide outlines the modern iOS 17 / macOS Sonoma design system implemented to give FocusBoundary a beautiful, calm, material-centric interface.

---

## 1. Design Language & Principles

*   **Materials & Transparency (Vibrancy):** Utilizes translucent layers with heavy backdrop filters (`blur(20px)`) over a soft mesh background gradient, mimicking Apple's dynamic wallpapers.
*   **Border highlights instead of hard dividers:** Elements use semi-transparent borders (`rgba(255,255,255,0.5)`) to catch highlights, while standard lines are extremely thin (`rgba(0,0,0,0.05)`).
*   **iOS 17 Micro-Capsules:** Notifications and indicators use fully rounded capsule geometry with high visual contrast.
*   **Squircular Geometry:** Containers and buttons utilize larger, smoother rounded corners (`14px` and `22px`) mimicking iOS home screen widgets.
*   **Calm Color Fields:** Primary areas employ high transparency white backgrounds (`rgba(255,255,255,0.7)`) to absorb the Siri-like gradient background colors.

---

## 2. Dynamic Material Tokens (`src/index.css`)

```css
:root {
  /* Dynamic Material Color Palette */
  --bg-base: #f5f5f7; 
  --bg-surface: rgba(255, 255, 255, 0.7);       /* Translucent glass sheet */
  --bg-surface-solid: #ffffff;
  --bg-surface-elevated: rgba(255, 255, 255, 0.85);
  
  --border-color: rgba(0, 0, 0, 0.05);           /* Hairline card boundary */
  --border-glass: rgba(255, 255, 255, 0.5);       /* Glass highlighted edge */
  
  --text-primary: #1d1d1f; 
  --text-secondary: #86868b; 
  --text-muted: #a1a1a6;
  
  /* System Accent Markers */
  --accent-primary: #0071e3;                     /* SF Blue */
  --accent-cyan: #30b0c7;
  --accent-purple: #af52de;                      /* SF Purple */

  /* Corner Geometry */
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 22px;                             /* Apple Squircle emulation */

  /* Diffuse iOS Shadows */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.02);
  --shadow-md: 0 8px 30px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 20px 50px rgba(0, 0, 0, 0.06);
}
```

---

## 3. Component Details

### 3.1 Siri Mesh Wallpaper Background
The viewport background is styled using a fixed-position mesh overlay composed of four intersecting radial gradients that create a soft, abstract gradient (mixing light-blue, soft purple, and warm peach hues) behind the planner sheet.

### 3.2 Floating Glass Columns
*   Kanban columns (`.weekday-column`) use translucent glass styling (`background: rgba(255,255,255,0.45)`, `backdrop-filter: blur(15px)`) and are styled as widgets.
*   Header and section separators are thin hairlines. Old diary top-borders are removed.

### 3.3 Task Cards & Checkboxes
*   **Translucent Squircle Cards:** Task cards use `rgba(255,255,255,0.88)` backgrounds with a very soft shadow (`0 4px 12px rgba(0,0,0,0.02)`).
*   **Fluid Hover State:** Cards scale smoothly by 1% (`scale(1.01)`) and slide upward on active mouse hover, rendering a soft shadow.
*   **Reminders Circular Checkbox:** Minimalist circular outline that fills solid blue on check with a white vector tick mark.

### 3.4 Floating iOS Notification Toast
Replaced the yellow warning undo bar with a floating dark grey capsule (`background: rgba(28,28,30,0.95)`, `backdrop-filter: blur(10px)`) that mimics iOS Dynamic Island messages.
