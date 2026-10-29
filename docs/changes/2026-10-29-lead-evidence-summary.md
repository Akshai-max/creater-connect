# Lead page: evidence summarised instead of one long list

**Date:** 2026-10-29
**Files:** `app/leads/[id]/evidence.tsx` (new), `app/leads/[id]/page.tsx`

## Why
On a lead page, the Evidence card listed every stored item as a row. For JeffMara Podcast that was 57 rows, 50 of them videos:
- the videos were oldest first;
- every row had a "youtube.com ↗" label;
- one-value facts (profile, country, monetization) each took a whole section.

You asked for it to be nicer and summarised.

## What changed
The evidence rendering moved out of the page into `app/leads/[id]/evidence.tsx`, one small component per kind. The page renders `<EvidenceSections evidence={…} />`.

- **Facts tiles:** Profile ("YouTube channel"), Country and Monetization sit side by side in one row.
- **Recent content:**
  - a one-line summary: number of videos, long-form count and share, upload rhythm ("about daily", "every ~4 days", "every ~2 weeks"), and the date range;
  - the **5 newest**, newest first, then "Show all N videos" (a `<details>`, so no client JS);
  - a film icon marks long-form (blue) versus short (grey) instead of a "Long-form" badge on every row.
- **Contact routes:** one line each, with a channel icon, the address or handle, and under it the channel, use, last active date and where it was found. This lucide version has no brand logos, so the icons are neutral: mail, camera, briefcase, play.
- **Need:** the observation is the main text, and the need type (for example "Captions") is a small badge.
- **Every row:** the text itself is the link, with an icon on hover and the site in the tooltip. Rows with no source link still say so in red, and AI-sourced items keep their "AI · check it" badge.
- **Unchanged:** the header, tiles, outreach drafts, qualification, "How to reach them" and score cards (the other session's layout).

## Checked
- **Rendered with JeffMara Podcast's real 57 evidence rows**, using `react-dom/server`:
  - tiles: YouTube channel · US · Membership;
  - "Who runs the channel", "Need" and both contact routes;
  - Recent content: "50 videos · 50 long-form (100%) · uploads about daily · Sep 9 – Oct 29, 2026", newest first (Oct 29, 28, 27, …), then "Show all 50 videos".
- **Type-check** and `next build` (`/leads/[id]` compiled).
- **Not seen in the browser:** the page needs your sign-in.
