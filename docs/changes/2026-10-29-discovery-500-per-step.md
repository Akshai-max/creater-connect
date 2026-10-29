# Discovery: up to 500 new channels per step

**Date:** 2026-10-29
**Files:** `scripts/engine-cycle.ts`, `scripts/classify-entities.ts`

## Why
You asked for 500 creators per fetch instead of 50, run as fast as possible.

## What changed
- **`--max-new` (new option, default 500):** how many new channels one discovery step may add. It was a fixed 50. Channels found beyond the cap still carry over to the next step.
- **`--searches`: 2 → 12** per step. One YouTube search page gives at most 50 channels, so 500 new ones need about 10–15 pages.
- **`--classify-limit` (new option, default 150):**
  - At most 150 entity-check model calls per cycle. The rest are done in the next cycles.
  - Without it, 500 new channels would hold the cycle lock for most of an hour while Groq/Gemini rate limits are waited out, and the 20-minute runs would be skipped.
- **The entity check's `--limit` now counts model calls, not rows.**
  - Rows left "for review" are answered from the cache on every run and sit before the newly added rows.
  - With a row limit, most of the 150 would have been spent re-reading the cache.
  - Cached answers are still applied to every row, as before.

Unchanged: discovery every 20 minutes, 25 featured lookups, the 7,000-unit daily cap, and the 10-channel refresh.

## What to expect
- **Cost of a step:** a full step is estimated at about 2,300 YouTube units (1,200 for 12 searches, plus about 2 per new channel).
- **Steps per day:** with the 7,000-unit cap, about **3 big steps** run right after the quota resets (midnight US Pacific, 13:30 IST). After that the log says "daily discovery budget reached" until the next reset.
- **Today:** about 1,340 units were already used, so only about 2 big steps fit before the reset.
- **Channels per day:** the daily total is still limited by quota, roughly 1,000–1,500 new channels a day at most. In practice it's fewer, as searches start returning channels already in the file. Bigger steps don't raise that ceiling; they only front-load it. Add search topics to `data/discovery-queries.txt` to keep the yield up.
- **Run length:** a 500-channel step takes several minutes to fetch.
- **Entity check backlog:** it catches up at 150 checks per cycle, about 4 cycles (80 min) for a full batch.

## Checks
- `npx tsc --noEmit` is clean.
- `npm test`: 93/93 pass.
- Not yet run end to end. The next scheduled cycle is the first real 500-channel step; check `data/engine-cycle.log` or the Engine page.
