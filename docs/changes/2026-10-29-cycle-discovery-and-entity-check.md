# The 20-minute engine cycle now finds new channels and checks them

**Date:** 2026-10-29
**Files:** `scripts/engine-cycle.ts`, `lib/leads/cycle-discovery.ts` (new), `lib/leads/discovery.ts` (`searchChannelPage`), `tests/cycle-discovery.test.ts` (new)
**Data (git-ignored):** `data/discovery-queries.txt` (new), `data/discovered-2026-10-29.csv`, `data/channel-ids-2026-10-29.txt`, `data/engine-cycle-state.json`. Backups are in `data/backups/*.before-cycle-discovery.*`.

## Why
The engine ran every 20 minutes and every run succeeded, but the leads never changed. Each cycle only refreshed subscriber counts and upload dates for the same 275 channels and reran the engine on the same file. It never searched for new channels, and it never ran the entity check, so a new channel would have stayed "needs review" anyway.

## What changed
Each cycle now has two steps before the refresh.

**1. Discovery** (`lib/leads/cycle-discovery.ts`)
- **Where searches come from:** `data/discovery-queries.txt`, one search per line, each run in every region from `--regions` (default `US,GB,CA,AU,IE,NZ,SG`). It starts with the four searches from the first discovery run. Add lines to widen it; without the file there is no discovery.
- **Depth first:** each step runs `--searches` (default 2) YouTube searches. It stays on one query × region and goes one results page deeper each time, until that pair runs out of pages, then moves on. Page 1 of every pair was already collected by the first discovery run, so going wide first would have found almost nothing.
- **Only new channels are fetched:** up to 50 per step, through the official API, and appended to the input CSV and the id file. The 30-channel refresh then covers them too. New channels found beyond the 50 are saved and fetched first next time.
- **Limits:** at most once every `--discover-every` minutes (default 120), and at most `--discover-units` YouTube units a day (default 4,000). The count resets at midnight US Pacific, like the YouTube quota.

**2. Entity check:** `scripts/classify-entities.ts` runs on the input. Answers are cached, so only new channels cost model calls, through Groq or Gemini (see the AI usage page).

**Other details:**
- `--no-discover` and `--no-classify` turn either step off.
- If either step fails, it's logged and the refresh and engine still run.
- The progress (`discovery` in `data/engine-cycle-state.json`) is kept next to the existing refresh cursor.

## Quota
| | Units a day |
|---|---|
| refresh: 72 cycles × 61 | ≈ 4,400 |
| discovery: 12 steps × about 300 (2 searches + about 100 for 50 channels), capped | ≤ 4,000 |
| **total**, against YouTube's 10,000 | **≤ about 8,400** |

## Update: a search every 40 minutes
You asked for new creators to appear more often. The new defaults:

| | Before | Now |
|---|---|---|
| discovery | 2 searches every 120 min, cap 4,000 units a day | **1 search every 40 min**, cap 7,000 |
| refresh | 30 channels every 20 min (≈ 4,400 units a day) | **10 channels** every 20 min (21 units, ≈ 1,500 a day) |
| total | ≤ about 8,400 | ≤ about 8,500 of 10,000 |

- **New channels arrive about 3 times as often:** up to 36 searches a day, up to 50 new channels each.
- **Existing channels refresh less often:** each one's subscribers and upload dates update about once a day (337 ÷ 10 per cycle × 20 min ≈ 11 h), instead of every ~3½ h.
- **2 minutes of slack:** the 40-minute check accepts a cycle that starts a little early, so the 20-minute schedule doesn't skip every other search.
- **Checked:** 84/84 tests, including the slack. In a real cycle, 1 search (US page 2) found 50 channels, 10 of them new. The entity check confirmed 2 individuals and excluded 1, and the refresh cost 21 units. The file now holds 337 channels.

## Checked
- **Tests:** `tests/cycle-discovery.test.ts` uses a fake YouTube API. It covers picking the pair (wrap-around, skipping finished pairs, all done), keeping only new channels, going one page deeper, the every-120-minutes rule, the daily budget and its Pacific-midnight reset, and carrying over channels beyond the cap. Overall 83/83, plus type-check.
- **Three real cycles** (`npm run engine-cycle`; the second and third with `--discover-every 0` to skip the wait):

| Cycle | Searches | New channels | Entity check | Engine |
|---|---|---|---|---|
| 1 | "video podcast interview", US and GB, page 1 | 1 | 1 checked, 79 from cache | 276 rows: 3 qualified / 113 / 160 |
| 2 | same query, CA and AU, page 1 (before depth first) | 1 | 1 checked: 1 individual | 277 rows: 3 / 113 / 161 |
| 3 | same query, US, pages 2 and 3 | **50** (75 found: 32 + 43) | 16 checked: 3 individual, 1 excluded | **327 rows**: 3 / 128 / 196 |

- **YouTube units used today by discovery:** 707.
- **The 25 channels dropped in cycle 3,** before the carry-over existed: the US pair was pointed back to page 2, so the next step searches pages 2 and 3 again and picks them up. The 50 already added are skipped.

## Still true
**The qualified count stays at 3 for now.** New channels are found and checked, but most creators publish no business email in their YouTube text, and the engine never guesses one. That's the main blocker (see [First run on Groq and Gemini](2026-10-29-first-free-llm-run.md)). Each new channel still goes through the same rules and still needs a person's review before any outreach.
