# Engine page: status first, simpler run table

**Date:** 2026-10-29
**Files:** `app/engine/page.tsx`

## Why
The page was an 11-column table of raw counters:
- "New / upd / same", "Qual / unver / rej", "Dupes", "Failed", plus "$0.0000 · 21u" in every row;
- each row led with a long run id;
- the useful facts (is it running, when is the next search, how much quota is left) were buried in two lines of small grey text.

## What changed
- **Status banner** in one line, with three possible states:
  - "Running normally · last run 3 min ago" (green);
  - "No run for 2 h", which means check the scheduled task (amber);
  - "Last run failed" (red).
- **Five tiles:**
  - qualified leads (with to-review / rejected under it);
  - new channels today (with the next search time);
  - runs today (with failures);
  - YouTube units today (out of the 10,000 limit);
  - search quota used today, as a percentage bar against the discovery budget.
- **Run table, 6 columns instead of 11:**
  - **When:** the time, with the short run id underneath.
  - **Result:** done or failed, the runtime and how many leads it checked. Errors fold out here.
  - **New channels:** "+30 new channels" (click for the searches), "Searched · none new", "No search this run" or "Daily search quota used", plus the entity-check line. Older runs show "—" because they have no cycle data.
  - **Changes:** "30 added · 2 updated" or "No changes". Duplicates and failures appear only when there are any.
  - **Leads after run:** one stacked bar (green qualified, amber to review, grey rejected) with the three numbers. A legend sits in the card header.
  - **YouTube units:** the dollar cost appears only when it isn't zero.
- The manual-run command and the total cost moved to a footer line.
- The seed tests card has the same data, with capitalised labels and a one-line explanation.

The page shows the same data as before; only the layout changed. It adds one query, for today's runs, so the "today" numbers aren't limited to the 30 rows shown.

## Checks
`npx tsc --noEmit` is clean.
