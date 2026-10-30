# Count YouTube quota the way the key's quota page does: 100 searches + 10,000 units

**Date:** 2026-10-30
**Files:** `scripts/engine-cycle.ts`, `lib/leads/cycle-discovery.ts`, `app/engine/page.tsx`, `tests/cycle-discovery.test.ts`

## Why
- **Searching stopped early.** The Engine page said "Daily search quota used" with only about half of the key used. You asked for the full 10,000 per key, in steps of about 1,000, with roughly 10 steps before you switch to a new key.
- **The quota page showed two separate daily limits** for the project:

| Quota | Limit | Used (about 08:40 UTC) |
|---|---|---|
| Search Queries per day | **100** | 41 |
| Queries per day | 10,000 | 2,212 |

A search counts against its own limit of 100 a day, not as 100 of the 10,000. The engine charged 100 units per search, so its counter read 5,478 when Google's read 2,212 (41 searches × 100 = 4,100 of the gap). On top of that:
- **The cap was set at 7,000.**
- **Each step reserved about 2,300 units** (12 searches plus up to 500 channels), so discovery stopped at about 5,500.
- **Refresh and contact units weren't counted.**
- **The Engine page read the run still in progress:** "It took — and checked 0 leads", "0 qualified".
- **"YouTube units today 16,304 / daily limit 10,000"** added up every key used since midnight.

## What changed
**Two counters per key, as Google lists them**
- `searchesToday`, against `--daily-searches` (100);
- `unitsToday`, against `--discover-units` (10,000), with `--reserve-units` (100) kept back for the 20-minute refreshes.
- **A search costs 1 unit** (`--search-units 1`) and 1 of the 100 searches. For a project on the classic model, use `--search-units 100 --daily-searches 100000`.
- **Everything counts:** refresh and contact units are added to the same unit counter after each run.
- **Both counters reset** at midnight US Pacific and when the key changes (new fingerprint).

**Steps of about 1,000 units, about 10 per key**
- Each step makes `--searches 10` (was 12, then 5) and adds up to `--max-new 400` channels (about 2 units each). With featured lookups, guest links and Apple Podcasts, a step is roughly 930 units.
- 10 steps use the key's 100 searches and most of its 10,000 units.

**When the 100 searches are used,** the cheap sources (featured channels, guest links, Apple Podcasts) keep running on units, and the step says "searches: all 100 for today used, cheap sources only". When the units run out, it says "this key's daily YouTube quota is used … switch to a new key or wait for the reset".

**Engine page**
- **The banner and tiles use the last finished run;** a run in progress shows as "Running now · started 2 min ago".
- **"This key's quota today"** has two bars, **Searches x / 100** and **Other calls x / 10,000**, plus "about N more search steps", "Searches used up: other sources still run. Switch key for more searches", or "Used up: switch to a new key".
- **Run rows** with a used-up key say "Key's quota used: switch key".
- **"YouTube units today"** is labelled "all keys used today".

**Today's counters set by hand** to your quota page's figures plus the 08:42 cycle that ran after it: 46 searches, 2,512 units.

## Checked
- **Tests:** 106/106 (new: 99 of 100 searches used means only 1 more search, it costs 1 unit, cheap sources keep going after the limit, and a new Pacific day resets both). Type-check and `next build` pass.
- **The 08:42 cycle,** the last one under the old settings: 5 searches plus featured, guest links and Apple added **75 channels** (3,758 total), with 3 business emails found and **31 qualified**.

## Worth knowing
- **Searches are the real limit:** 100 a day per Cloud project. A new key gives fresh quota only if it's from a different project.
- **Older projects** may show no "Search Queries per day" row. Then searches still cost 100 units; use `--search-units 100`.
