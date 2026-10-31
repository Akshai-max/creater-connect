# Spend the units that searches can't: one region, more guest links; 429 doesn't fail the step

**Date:** 2026-10-31
**Files:** `scripts/engine-cycle.ts`, `lib/leads/cycle-discovery.ts`, `lib/leads/discovery.ts`, `tests/cycle-discovery.test.ts`

## Why
You asked why the 10,000-unit quota isn't being used.

**Searches are the limit, not units.** A key gets 100 searches a day, and a search costs 1 unit. Units are spent fetching the channels the searches find (about 2 each). The first cycle on the new key (06:43 UTC) used all 100 searches, added **1,238 new channels** and used **2,649 of 10,000 units**. The rest can't be reached through searches.

**Two kinds of waste showed in that cycle's log:**
- **The same search in 7 regions finds the same channels.** "leadership podcast" pages found 31–47 new channels each in the US, but 0–2 in GB, AU, CA, IE, NZ and SG. The newest-video searches were the same: "youtube growth coach" found 25 new in the US and 0–1 elsewhere. More than half of the 100 searches found almost nothing.
- **Guest links waited:** 2,306 channel links from video descriptions were queued, but only 20 were checked per step (1 unit each).

**Before that, every run from 10:12 to 11:52 showed "Search failed".** The old key's searches were refused with `HTTP 429 rateLimitExceeded`. The app only recognised `quotaExceeded`, so the whole discovery step failed instead of carrying on with the other sources. A test search with the new key returned HTTP 200. The failing runs had all used the previous key (a different fingerprint), because each cycle reads `.env.local` when it starts.

## What changed
- **`--regions` defaults to `US`** (was 7 regions), so the searches go to different queries instead of repeating one per region. A channel's country still comes from its own settings, so creators in the UK, Australia and so on are still found.
- **`--guest-scan` 25 → 200** existing channels' descriptions read per step (2 units each), and a new **`--guest-resolve`** (default 1,500, was a fixed 20) for queued links checked per step (1 unit each). These use the units searches can't. The step still takes only as many as the key's remaining units allow.
- **YouTube's `429 rateLimitExceeded` stops that kind of call for this step only.** YouTube doesn't say whether the limit is per minute or per day, so the day isn't marked used. The step carries on with the other sources, logs "YouTube is rate-limiting this key's searches for now; trying again next step", and tries again next step. `isRateLimited` in `discovery.ts`.

## Checked
- **Tests:** 115/115, plus type-check. New test: a search refused with 429 `rateLimitExceeded` → the step doesn't fail, the search count isn't marked used, and the featured channel is still added.
- **The real API:** a direct test search with the current key returned HTTP 200, and the 06:43 cycle added 1,238 channels on the new key.

## Worth knowing
- **The entity check did nothing that cycle** ("checked 0"): the free AI quotas were used up, so new channels wait for Groq, Gemini or OpenRouter to come back.
