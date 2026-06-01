---
name: FocusBoundary Design System
description: Portable skill detailing the design guidelines, variables, and components for FocusBoundary's modern Apple Minimal (macOS Sonoma / iOS 17) UI.
---

# FocusBoundary Design System Skill

This folder contains the complete visual, layout, and typography definitions for the clean, low-color, Apple Minimal aesthetic of FocusBoundary.

## Core Visual Theme
- **Low-Color Cool Gray Wallpaper**: Background styled using faint radial intersecting cool-gray and off-white gradients, mimicking Apple Sonoma settings workspaces.
- **Translucent Glass Material (Vibrancy)**: Kanban columns, headers, and modal overlays utilize translucent white sheets (`rgba(255, 255, 255, 0.7)`) with heavy backdrop blurs (`blur(20px)`).
- **Borderless Row Layouts**: Task cards sit as borderless, transparent rows separated by ultra-thin hairline dividers (`1px solid rgba(0,0,0,0.04)`), hiding actions (Star, Play, Delete) unless hovered or focused.
- **Reminders Circular Checkboxes**: Minimal circular outlines that fill standard system blue with white vector checkmarks upon completion.
- **Functional Color Badges**: Monochrome point capsules with soft blue highlights for 5 pt Focus Blocks, and amber/orange warnings for 8 pt Epics, guiding user attention to capacity risks.

## File Hierarchy
- `./tokens/colors_and_type.css` — Standardized CSS Variables.
- `./README.md` — Visual brand guidelines and index of components.
- `./features_and_problems.md` — Product value matrix and feature documentation.
