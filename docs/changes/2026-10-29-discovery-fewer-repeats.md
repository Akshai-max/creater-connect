# Discovery finds fewer channels it already has

**Date:** 2026-10-29
**Files:** `lib/leads/cycle-discovery.ts`, `lib/leads/discovery.ts` (`searchRecentVideoChannels`, `fetchFeaturedChannels`), `scripts/engine-cycle.ts`, `tests/cycle-discovery.test.ts`
**Data (git-ignored):** `data/discovery-queries.txt` (4 → 16 searches), `data/engine-cycle-state.json`

## Why
YouTube's channel search ranks by relevance, so it keeps returning the same well-known channels. The last channel search returned 50 channels, and only 10 were new. Each search costs 100 quota units whatever it returns.

## What changed
All four fixes you asked for:

1. **Recent-video search.** It searches *videos* (`type=video`, `order=date`), published since that query × region was last searched (the first time, the last 7 days), and takes the channel behind each video.
   - Every search covers a new time window, so results are mostly new channels.
   - Every channel found has just posted, which the activity rule wants anyway.
   - With `--search-mode both` (the default), searches alternate between this and the channel search. `video` or `channel` uses only one.
2. **Worn-out channel searches are dropped.** A channel-search page after the first that brings fewer than `--min-new` (10) new channels ends that search, and the next one starts. Before, it paged to the end even when a page was 80% repeats.
3. **Fewer regions, more searches.** The regions are now `US,GB,AU` (was 7): English results barely differ between regions, and a channel's country comes from its own settings, not the search region. `data/discovery-queries.txt` now has 16 searches, the original 4 plus specific topics (marketing, personal finance, real estate investing, fitness, career, leadership…). Edit that file to change them.
4. **Featured channels.** For up to `--featured` (10) confirmed individual creators per step, it looks up the channels they feature on their own page (`channelSections`, **1 unit** each instead of 100 per search). Each creator is looked up once.

**Unchanged:**
- One step every 40 minutes, the 50-new-channels cap per step (extras carry over), and the 7,000-unit daily cap.
- Each step costs about 210 units: 1 search, up to 10 lookups and the fetch of new channels.

## Checked
- **Tests:** 9 in `tests/cycle-discovery.test.ts`, 88 overall, plus type-check. The new ones cover:
  - the video search's time window (first 7 days, then since the last search) and the rotation;
  - `both` alternating video and channel searches;
  - a worn-out page (2 new of 50) ending the search even though more pages exist;
  - featured channels counted at 1 unit and looked up once per creator.
- **One real cycle** (`--searches 2 --discover-every 0`):

| Source | Returned | New |
|---|---|---|
| featured channels of 10 confirmed creators | 12 | **12** (10 units) |
| newest "video podcast interview" videos in the US, last 7 days | 43 channels | **43** |
| *for comparison: the previous channel search (page 2)* | *50* | *10* |

- **Effect of that cycle:** 50 added, which hit the cap, so the channel search wasn't needed and 5 carry over. The file went from 337 to 387 channels. The entity check checked 16: 4 individual, 3 excluded. 211 units.

## Still true
Qualified stays at 3 for now. The blocker is still contact routes: most creators publish no business email, and none is guessed.
