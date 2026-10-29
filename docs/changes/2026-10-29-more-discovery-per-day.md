# Find more creators per day

**Date:** 2026-10-29
**Files:** `scripts/engine-cycle.ts` (defaults only)

## Why
You asked for more creators to be fetched. Discovery was limited by its spacing, not by quota:
- it ran every 40 minutes, with 1 search and up to 10 featured-channel lookups;
- each step added 9–30 new channels;
- by 19:52 it had used only 1,339 of its 7,000 daily units.

## What changed
| Setting | Before | Now |
|---|---|---|
| `--discover-every` (minutes between discovery steps) | 40 | **20**: every cycle searches |
| `--searches` (YouTube searches per step) | 1 | **2** |
| `--featured` (confirmed creators whose featured channels are read) | 10 | **25** |

Unchanged:
- 50 new channels at most per step (any extra carry over to the next step);
- the 7,000-unit daily cap for discovery, and the 10-channel refresh;
- guest links, Apple Podcasts and the entity check.

## What to expect
- **Steps:** up to 72 a day instead of 36, each estimated at about 250–400 units.
- **Quota:** the 7,000-unit cap now gets used up, roughly 20–28 steps into the US Pacific day (from about 13:30 IST). Searching then pauses until the next reset, while the refresh and engine keep running.
- **Total quota:** stays within the 10,000-unit limit: refresh about 1,500 + discovery at most 7,000.
- **New channels:** roughly 2–3× more per day while the search topics last. Add more lines to `data/discovery-queries.txt` to keep the searches finding new channels.
- **Qualified leads:** more channels doesn't by itself mean more qualified leads. Most new channels stop at "unverified" because they have no business contact.

To change any of these without editing code, pass the flag, for example `npm run engine-cycle -- --searches 3`.

## Checks
- `npx tsc --noEmit` is clean.
- `npm test`: 93/93 pass.
- The next scheduled cycle will show the new numbers in `data/engine-cycle.log` and on the Engine page.
