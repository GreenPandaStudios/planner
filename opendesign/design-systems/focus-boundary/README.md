# FocusBoundary Design System Guide

This design system defines the modern, sleek, and calm macOS Sonoma / iOS 17 visual theme implemented in FocusBoundary. It is designed to minimize cognitive overload, protect user attention, and provide clean responsive interfaces.

---

## 1. Visual Aesthetics & Design Motifs

- **Translucent Glass Sheets:** Column blocks (`.weekday-column`) and popups utilize translucent white sheets (`rgba(255, 255, 255, 0.7)`) with heavy backdrop blurs (`blur(20px)`), catching highlights from the background.
- **Cool Gray Mesh Wallpaper:** The base background uses a fixed overlay of faint cool-gray and off-white radial gradients. It is desaturated to prevent visual fatigue while keeping the interface feeling modern and organic.
- **Apple Reminders Circular Checkbox:** Replaced square checkboxes with circular outline shapes (`border-radius: 50%`) that fill system blue with a clean vector checkmark upon completion.
- **Things 3 Borderless Task Rows:** Removed heavy card backgrounds, borders, and margins. Task items are flat, borderless rows separated by `1px solid rgba(0, 0, 0, 0.04)` hairline lines. Action items are hidden by default and fade in only when hovered/focused.
- **Functional Color Hierarchy:** Colors are removed from standard badges and assets to maintain visual calm. Color is applied strictly for functional alerts (e.g., warm warning amber on 8pt Epics, soft focus blue on 5pt Focus Blocks, warning orange/red on the points progress indicator when capacity limits are approached or breached).

---

## 2. Typography Pairing

- **Display Headings (Header / Column Titles):** `Inter` bold with a negative letter-spacing (`-0.015em`) for a modern, native iOS display format. (No serif typography is used).
- **Body & Subtitles:** `Inter` regular / medium with `-0.01em` spacing for sharp readability at small sizes.
- **Sizing Metrics / Indicators:** `JetBrains Mono` or clean `Inter` mono sizing for point counters.

---

## 3. Brand Voice & Tone

- **Quiet & Supportive:** The interface never flashes, pushes intrusive warnings, or locks the user out. The Negotiator sidebar remains non-blocking on the side, allowing schedule interaction while talking.
- **Zero Emoji Clutter:** Colorful emojis are banned across headers, switcher controls, suggest banners, and loaders, replaced instead by clean vector outline icons.
- **Minimalist Elements:** Explanations and advanced configurations are collapsed under hidden menu groups. Action verbs are represented by clean vector icons (e.g., Star, Play, Trash) rather than text.

---

## 4. Product Strategy & Documentation

- [Features & Problems Matched](file:///home/august/src/planner/opendesign/design-systems/focus-boundary/features_and_problems.md) — Read the complete functional mapping detailing FocusBoundary's features and the specific user overload problems they solve.
- [Dynamic Design Tokens](file:///home/august/src/planner/opendesign/design-systems/focus-boundary/tokens/colors_and_type.css) — Canonical CSS variables mapping.
