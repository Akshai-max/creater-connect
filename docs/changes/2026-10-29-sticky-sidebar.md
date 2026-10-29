# Sidebar stays on screen on long pages

**Date:** 2026-10-29
**Files:** `components/sidebar.tsx`

## Why
The sidebar stretched to the full height of the page. On long pages such as Leads, AI usage and Engine, scrolling down moved the menu off the top of the screen. All that was left on the left was an empty dark column, with "Sign out" at the very bottom.

## What changed
- The sidebar is now `sticky top-0 h-screen shrink-0`. It stays the height of the window and stays in place while the page scrolls. The menu is always visible, and Sign out sits at the bottom of the window.
- The menu list scrolls on its own (`overflow-y-auto`) if the window is too short to fit every link.

## Checks
In the browser at 1280×800, with the page made 3,000 px taller and scrolled down 2,500 px, the sidebar stayed at the top of the window (top 0 px, height 800 px).
