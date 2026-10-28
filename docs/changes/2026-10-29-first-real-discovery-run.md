# First real discovery run (YouTube key verified)

**Date:** 2026-10-29
**Files:** none (a run, not a code change). Output in `data/discovered-2026-10-29.csv` (git-ignored).

## Key check
`YOUTUBE_API_KEY` was tested with one `channels.list` call (1 quota unit): HTTP 200 with a real channel back.

## Runs
| Run | Command | Channels | Quota units | Time |
|---|---|---|---|---|
| Smoke | `--query "video podcast" --regions US --max 10` | 10 | 121 (twice: before and after the language fix) | 12 s |
| Full | `--query "video podcast interview;business coach;online course creator;entrepreneur podcast" --regions US,GB,CA,AU,IE,NZ,SG --max 50` | 275 unique (1 channel returned 404, logged) | 3,357 | ~10 min |

Searches overlap heavily across regions, so 28 searches returned 275 unique channels rather than 1,400. About 3,600 of the day's 10,000 units were used.

## What discovery found (275 channels)
| Signal | Channels |
|---|---|
| Monetization evidence (sponsor reads, courses, memberships…) | 151 |
| Published business email | 56 |
| Published Instagram link | 131 |
| Published LinkedIn link | 64 |
| Stated need ("hiring an editor"…) | **2** |

## Engine result
`npm run engine -- --input data/discovered-2026-10-29.csv`: 25 s, 274 inserted, 1 updated, 0 duplicates, 0 failed.

| Status | Leads (285 total, including the 10 smoke rows) |
|---|---|
| Qualified | **0** |
| Unverified | 122 |
| Rejected | 153 |

**Why none qualify yet:**
- **Entity.** Every discovered row starts as `needs_review`, and a person must confirm it's an individual creator. This is by design.
- **Need evidence is the real bottleneck.** 127 of the 128 unverified rows have none. Even after a person confirms the entity, only 10 rows would be blocked by "need" alone.
- **Rejections are mostly genuine.** 119 were inactive (fewer than 8 items in 30 days and fewer than 2 long-form in 60). 103 failed on country: 32 India, 31 with no declared country, and others such as ZA, PH and DE.
- **Contact.** 110 unverified rows have no reachable channel yet. The Instagram check (`INSTAGRAM_ACCESS_TOKEN`) and manual LinkedIn confirmation would add backup channels.

## Country mix (all 285)
US 109, no declared country 82, IN 32, GB 21, AU 9, CA 8, ZA 4, others 1–2 each.

> **Update:** after [observed need signals](2026-10-29-observed-need-signals.md), need evidence covers 140 of 275 channels. The main blocker is now contact.

## Next
1. Tighten queries toward approved countries, and expect fewer IN results by avoiding generic English terms.
2. Decide how "need" evidence is found (see the summary in chat). This decides whether 1,000 qualified is reachable.
3. Review rows: confirm `entity_type`, fill need evidence where it exists, rerun the engine.
