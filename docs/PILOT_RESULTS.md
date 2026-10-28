# Pilot: real creators through the discovery pipeline (2026-10-28)

**Purpose:** prove the engine works end to end on *real* public data and measure where the evidence gaps are. This is AI-assisted research. Claude Code ran the steps below, and it's disclosed as such in workbook 00_START.

**Result: 0 qualified, 12 unverified, 4 rejected.** No lead was qualified on incomplete evidence. The input and output files are git-ignored (`data/`, `exports/`) because they hold real creator contact details.

## What was done

1. **Channel IDs:** 16 well-known creator channels in the target niches (creator economy, productivity, business and finance education, podcasts). Each channel's stable `UC…` id was read from the canonical URL on its own public YouTube page. The list is in `data/pilot-channel-ids.txt`.
2. **Discovery:** `npm run discover-youtube -- --ids data/pilot-channel-ids.txt --out data/pilot-discovered.csv`. This uses YouTube's public per-channel RSS feed (no key, the last 15 uploads with exact dates and descriptions) and runs signal rules over the creators' own descriptions.
3. **Engine:** `npm run engine -- --input data/pilot-discovered.csv --dry-run --out exports/pilot`.

## What the pipeline found automatically (with source links)

| Signal | Found | How |
|---|---|---|
| Recent uploads with exact dates | 15 of 16 channels | RSS feed. Justin Welsh's feed returned no uploads. |
| Active (≥8 uploads in 30 days) | 9 of 16 | Ali Abdaal, Chris Williamson, Colin and Samir, Evan Carmichael, Lewis Howes, Amy Porterfield (15 each), Mark Tilbury (10), Vanessa Lau (9), Cal Newport (8) |
| Monetization evidence | 12 of 16 | Sponsor reads, promo and affiliate codes, courses, books and newsletters, each quoted from a specific video description with that video's URL |
| Published business email | 3 of 16 | Graham Stephan, Mark Tilbury and Vanessa Lau each publish one next to "business inquiries" in their own descriptions |
| Stated need (hiring an editor, backlog and so on) | **0 of 16** | No creator states a need in their recent descriptions |

## Why nothing qualified

The engine reports each missing item per lead in `exports/pilot/leads-all.csv`:

- **Need evidence (all 16):** the hardest field. Creators rarely state a need in their own content, and the sources that do carry it are job boards.
- **Entity confirmation (all 16):** `entity_type` starts as `needs_review`, because a channel may be run by a company or network. A person must confirm it.
- **Country and language evidence:** the RSS feed has no country. The official API supplies the self-declared country (`--api` with `YOUTUBE_API_KEY`).
- **Contact route (13 of 16):** no published business email in recent descriptions. These need the creator's website contact page or a LinkedIn or Instagram link with evidence.
- **Inactive (4 rejected):** Jay Clouse (last upload on this channel in 2021), Thomas Frank Explains (May 2026), Nicholas Reed (Jan 2026) and Pat Flynn (1 upload in 30 days and none of 2+ long-form in 60 days).

## Bug found and fixed by the pilot

The RSS feed carries no video durations. The first run therefore **rejected** active creators for having "0 long-form" videos, but the true count was simply unknown. Unknown lengths now make the activity check *unverified* with the reason "fetch durations with YOUTUBE_API_KEY". There's a regression test in `tests/discovery.test.ts`.

## Sources that were unavailable

The brief asks for each unavailable source to be recorded with the date, time and evidence. None of these were worked around.

| When (UTC) | Source | What happened |
|---|---|---|
| 2026-10-28 ~09:00 | ytjobs.co (YouTube creator job board, which would provide need evidence) | Bot-verification page ("Performing security verification"). Not bypassed. |
| 2026-10-28 ~09:10 | onlinejobs.ph job 1655652 (Brick by Brick Wealth, hiring a YouTube editor) | HTTP 403 for automated fetch, then a Cloudflare "quick security check" in the browser. Not bypassed. |
| 2026-10-28 ~09:10 | josephnoelwalker.com/video ("I'm hiring a short-form video editor", from a search result) | HTTP 404, so the page no longer exists. A dead link can't be evidence. |
| 2026-10-28 | YouTube Data API v3 | No `YOUTUBE_API_KEY` is configured, so there's no search, durations or self-declared country |

## How to turn the pilot into qualified leads

For each unverified row, open `review_notes` in `data/pilot-discovered.csv` and do the following:

1. Confirm it's an individual creator, then set `entity_type=individual`.
2. Add `country_iso2` and `country_evidence_url`, from the About page or the creator's site, and set `primary_language=en`.
3. Find **need** evidence on a page that opens. For example: a careers page hiring an editor or content role, a post asking for an editor, or a statement about a backlog or inconsistency. Fill `incubrix_need`, `need_signal_text` and `need_evidence_url`.
4. Find a **business contact route** the creator publishes: a website contact page, or LinkedIn or Instagram listed for collaborations. Include the evidence URL and the last-active date.
5. Rerun `npm run engine -- --input data/pilot-discovered.csv`.

With `YOUTUBE_API_KEY` set, `npm run discover-youtube -- --query "<topic>" --regions US,GB,CA,AU,IE,NZ,SG` finds new channels at about 100 quota units per query. It also fills in durations and country automatically, so steps 2 and the activity check need no manual work.
