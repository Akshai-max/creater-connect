# Engine runs 24/7, and a new key's searches go in one step

**Date:** 2026-10-30
**Files:** `scripts/engine-cycle.ts` (one default), and the "creator-crm engine cycle" scheduled task (machine setting, not in git)

## Why
You asked for the engine to run around the clock and to use a new key's full quota in one go.

## What changed
- **Scheduled task (this laptop only):**
  - It now starts on battery; before, it refused.
  - Unplugging no longer stops a running cycle; before, it did.
  - A run missed while the laptop slept starts when it wakes (`StartWhenAvailable`).
  - The laptop never sleeps on mains power, so it runs every 20 minutes for as long as the laptop is on. On battery Windows sleeps after 1 hour idle, and cycles pause until it wakes.
- **`--searches` default: 50 → 100**, so all of a key's daily searches (100) go in one step. The units then go on fetching the channels found (about 2 each, about 5,000 channels at most per key). The 100-unit reserve keeps the 20-minute refreshes going.

## The workflow for new keys
Put the new key on the `YOUTUBE_API_KEY` line in `.env.local` and save. The next cycle sees the change ("YouTube key changed" in the log), resets the counters and spends the new key's searches in that cycle. The key must come from a different Google Cloud project with YouTube Data API v3 enabled; another key in the same project shares its quota.

## What this doesn't change: qualified leads
Right now there are 4,687 leads: 50 qualified, 1,462 unverified and 3,175 rejected. Only about 1 in 100 channels found qualifies. Most are rejected for low activity, country or language, and most of the rest lack a business contact or a confirmed entity. More keys bring more channels, but 1,000 qualified leads at today's rate would need roughly 90,000 channels. The faster lever is the 1,462 unverified leads:
- the entity check, which was stopped this cycle because every free LLM was resting;
- the contact lookups, with 528 waiting at 25 per cycle (`npm run catch-up` does the whole backlog).

## Checks
- `npx tsc --noEmit` is clean.
- The task settings were read back after the change.
- The 100-search step takes effect from the next key change. It hasn't run yet.
