# Observed need signals

**Date:** 2026-10-29
**Files:** `lib/leads/discovery.ts`, `lib/leads/types.ts`, `lib/leads/normalize.ts`, `lib/leads/repo.ts`, `lib/leads/messages.ts`, `tests/observed-needs.test.ts`

## Why
The brief's "Needs IncuBrix" check asks for evidence of a need in "content creation, repurposing, editing, captions, publishing, consistency, backlog or team workflow". Discovery only accepted needs the creator *stated* ("hiring an editor"). In the first real run, 2 of 275 channels had one, so almost nothing could qualify. You chose to also count **observed** signals (2026-10-29).

## What changed

### Three observed needs
These are facts from the creator's public channel data, taken from the YouTube API responses discovery already fetches, so they cost no extra quota.

| Need | Observed when | Evidence URL | Message line |
|---|---|---|---|
| `captions` | ≥2 long-form videos (≥20 min) in the last 60 days, and none has an uploaded caption track (`contentDetails.caption = false`; YouTube's automatic captions don't count) | the newest of those videos | "I noticed your recent long-form videos, like "…", don't have an uploaded caption track." |
| `repurposing` | ≥2 long-form videos in 60 days, and no video of 3 minutes or less among the last 5+ uploads | the newest long-form video | "I noticed you publish long episodes like "…" but no Shorts or clips from them." |
| `publishing_consistency` | ≥4 uploads in 180 days, with one gap of 30+ days that's at least 3× the channel's usual gap | the first video after the gap | "I noticed there was a 41-day gap between uploads before "…"." |

### Rules that keep it honest
- **A stated need always wins.** Observations are only used when the creator states none.
- **Every observed need is labelled.** The new `need_source` column is `stated` or `observed`. It's stored on the need evidence row (`lead_evidence.source`), and `need_observation` holds the exact fact. `review_notes` also gets a line like `CHECK: need is observed, not stated (captions): 4 long-form videos in the last 60 days, none with uploaded captions`.
- **Unknown data is never evidence.** RSS rows (no durations or caption flags) and videos with missing fields produce no observation.
- **Messages never put words in a creator's mouth.** Observed needs read "I noticed…"; stated needs read "You mentioned "…"".

### Bug fixed on the way
Stated needs produced "You mentioned you mentioned "…"" in messages, because discovery already wrapped the quote in "you mentioned". The quote is now passed on its own.

### New data captured
For each video: `durationSec` and `hasCaptions`.

## Result
The same 275 channels were re-fetched by ID (`--ids … --api`, **556 quota units** instead of about 3,400 for a new search) and run through the engine:

| | Before | After |
|---|---|---|
| Channels with need evidence | 2 | **140** (124 captions, 13 consistency, 1 repurposing, 2 stated) |
| Unverified leads failing the need check | 127 | **24** |
| Leads blocked *only* by entity confirmation | 0 | **8** |
| Leads blocked only by contact (+ the message that depends on it) | – | **45** |

Still **0 qualified**: every discovered lead needs a person to confirm `entity_type = individual`. The main blocker after that is **contact**: 110 unverified leads have no confirmed reachable channel. Most have a published Instagram link that the Instagram check (`INSTAGRAM_ACCESS_TOKEN`) would confirm.

## Tests
`tests/observed-needs.test.ts` (5 tests):
- Captions and repurposing come from API facts, with the newest video as evidence.
- Nothing is observed from unknown data (RSS, null flags) or a single video.
- The consistency gap is measured against the usual rhythm.
- An observed need is labelled through to the messages, which say "I noticed" and never "You mentioned", and it passes the need check.
- A stated need wins and is quoted once.

## Risk to keep in mind
An auditor may judge "no uploaded captions" weaker than a creator's own words. The label, `need_observation` and the evidence URL make that judgement easy to check. If IncuBrix rejects observed needs, filter on `need_source = stated`.
