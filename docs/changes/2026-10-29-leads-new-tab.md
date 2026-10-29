# Leads page: a New tab and newest-first sort

**Date:** 2026-10-29
**Files:** `app/leads/page.tsx`

## Why
The Engine page showed new channels arriving (+50, +9…), but the Leads page didn't seem to change. It opens on the Qualified tab, which still has 3 leads. New channels land in Unverified or Rejected, sorted by score among hundreds of older ones, and nothing marked them as new.

## What changed
- **A New tab**, next to Qualified: leads first stored (`created_at`) within a window, whatever their status, with a count on the tab.
- **Window chips:** Last 2 hours (default), Last 24 hours, Last 7 days. The first discovery run was yesterday evening, so "today" would show almost everything; 2 hours shows what the scheduled cycle just found.
- **A summary line on the New tab,** for example "88 added · 0 qualified · 29 unverified · 59 rejected". Each row's "Why" column says what that lead still needs.
- **A "Newest first" sort,** the default on the New tab, and an **Added** column ("2 h ago", exact time on hover). Clicking the Added header sorts any tab by it.
- **Switching tabs resets the sort** to that tab's default: newest on New, score elsewhere.
- **No schema change:** `leads.created_at` already exists. It's compared as `timestamptz` in Postgres, and the window start is computed in code and passed as a parameter.

## Checked
- **The tab's queries against the database** (14:00 UTC):
  - last 2 hours: 88 leads (29 unverified, 59 rejected), newest first: The Sean Avery Rule, Wrestling RHAPup, Sy-Con (13:51);
  - 24 hours and 7 days: all 484, because the first run was 18 hours ago.
- **Type-check** and `next build` (`/leads` compiled).
- **Not seen in the browser:** the page needs your sign-in.

## Note
`app/leads/page.tsx` also has earlier uncommitted layout changes, with `docs/changes/2026-10-29-leads-page-ui.md`, that weren't made in this session. This change sits on top of them.
