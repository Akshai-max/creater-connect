# Engine page: show what each run's discovery did

**Date:** 2026-10-29
**Files:** `app/engine/page.tsx`, `scripts/engine-cycle.ts`, `lib/leads/engine.ts`

## Why
The runs table looked as if the engine kept fetching the same creators. Most rows showed "0 new" and "same 385" because only every second run searches for new channels, and the page didn't say which ones did. "Same" also read like "fetched again", when it means "re-checked, nothing changed".

## What changed
- **The cycle records its discovery and entity-check results with the engine run,** in the existing `metrics` JSON column, so no schema change. Recorded:
  - status (added, searched with nothing new, skipped, failed, off), channels added and units used;
  - each source, for example "featured channels of 10 confirmed creators: 5 listed, 5 new";
  - why it was skipped, and when the next search is due;
  - today's discovery units against the daily cap;
  - the entity-check counts.
- **The run's API units now include discovery.** Before, a run that searched still showed only the refresh's 21 units.
- **A new Discovery column on the Engine page:**
  - **+N new**, with the units used; click to see the sources;
  - **searched, 0 new**;
  - **no search · next HH:MM**, with a note when the daily discovery quota is used up;
  - **search failed**, with the reason;
  - **—** for manual runs, which have no discovery step;
  - under it, the entity-check result when it checked anything.
- **A line under the title:** when the next search runs, discovery units used today (for example 1,210 / 7,000), when channels were last added, and that runs in between only re-check existing leads.
- `EngineOptions` gains `extraMetrics` and `extraApiUnits`. Manual `npm run engine` runs are unchanged.

## Checked
- **The scheduled 13:02 cycle** (`run_20261029130300_cza6`) recorded: added 30 (5 carried over, 5 from featured channels, 20 from "video podcast interview" US page 3), 171 discovery units, next search 13:42, 1,210 / 7,000 today, and an entity check of 10 (2 individual). The run shows 192 units (171 + 21 refresh). The file now has 417 channels.
- **Overall:** 88/88 tests, type-check, and `next build` (`/engine` compiled).
- **Not seen in the browser:** the page needs your sign-in. Runs before 13:02 have no recorded discovery and show "—".
