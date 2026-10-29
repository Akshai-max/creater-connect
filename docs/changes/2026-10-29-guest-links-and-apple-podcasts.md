# Two more discovery sources: guest links and Apple Podcasts

**Date:** 2026-10-29
**Files:** `lib/leads/cycle-discovery.ts`, `lib/leads/discovery.ts` (`extractYouTubeRefs`, `resolveYouTubeRefs`), `lib/leads/podcasts.ts` (new), `scripts/engine-cycle.ts`, `tests/cycle-sources.test.ts` (new)
**Data (git-ignored):** `data/discovered-2026-10-29.csv`, `data/channel-ids-2026-10-29.txt`, `data/engine-cycle-state.json`. Backups are in `data/backups/*.before-guest-apple.*`.

## Why
You asked for other ways to find new creators. YouTube search costs 100 units a search and tends to return the channels it returned before. And most creators who pass the other checks publish no business email, which keeps qualified leads at 3.

## What changed
Each discovery step now runs, in this order: carried-over channels, featured channels, **guest links**, **Apple Podcasts**, then searches (only while there's still room under the 50-channel cap).

### Guest links (`--guest-scan`, default 25)
- **Where they come from:** podcast and interview descriptions often link the guest's channel. The step reads YouTube channel links in video descriptions: `youtube.com/@handle`, `/channel/UC…` and `/user/…`. Bare "@name" mentions are ignored, because they may be Instagram or X.
- **New channels:** their descriptions come with the fetch, so reading them costs nothing.
- **Existing channels:** 25 a step are read (2 units each) until all have been, about 17 steps for 426 channels.
- **Resolving:** a handle costs 1 unit (`channels?forHandle`). Results are cached in the state, so each handle is paid for once. A channel's links to itself are dropped. Up to 20 links are resolved per step; the rest wait for the next step.

### Apple Podcasts (`--no-apple` turns it off; `--apple-feeds`, default 15)
- **Search:** one search per step in Apple's public iTunes Search API (`media=podcast`, no key), rotating through the same query × region list.
- **Feeds:** for each podcast not seen before, its public RSS feed is read (10 s timeout, capped size). It gives the YouTube links in the show's own text and its newest 5 episodes, the newest episode date, and the `<itunes:owner>` email.
- **Only podcasts that link a YouTube channel are used,** because leads are keyed by YouTube channel.
- **The feed email** goes on the lead only if the lead has no email:
  - `email_source = published`, because the podcaster published it in their own feed;
  - evidence = the feed URL, last active = the newest episode date;
  - quote = `itunes:owner email in the RSS feed of "<podcast>"`;
  - **business use is left unset,** because nothing in the feed says it's for business enquiries;
  - review note: "CHECK: email … is from the podcast RSS feed (itunes:owner); confirm it reaches the creator".
- **Leads already in the file** with no email get the feed email the same way. An existing email is never replaced.
- **Cost:** no YouTube units except resolving a feed's YouTube link, about 1 per podcast that has one.

## Checked
- **Tests:** `tests/cycle-sources.test.ts` (5 tests; 93 overall), plus type-check. They cover:
  - link extraction (ids, handles, user names, trailing punctuation, bare @mentions ignored);
  - guest scan, resolution and caching, dropping self-links, and new guests' own descriptions read with their fetch;
  - feed parsing (owner email, newest episode, YouTube link, an invalid email rejected);
  - Apple: a podcast added with its feed email, one with no YouTube link skipped, an existing lead receiving the email;
  - a feed email never replacing an existing one.
- **One real cycle** (`--discover-every 0`, 13:50 UTC):

| Source | Result |
|---|---|
| featured channels (10 creators) | 19 listed, **19 new** |
| guest links | 25 channels read, 34 links; 20 resolved, **14 new**, 14 waiting |
| Apple Podcasts "video podcast interview" US | 25 podcasts, 6 link a YouTube channel, **5 new**, 2 feed emails |
| channel search, page 4 | 50 channels, 43 new (the cap was reached; the rest carry over) |

- **Effect:** 50 added (426 → 476 channels) for 285 units, and the entity check checked 23 (4 individual, 1 excluded).
- **The two feed-email leads were rejected by the engine, correctly:** DemNikoArt is in Germany (not an approved country) and its feed's newest episode is from March, so the email is too old. Graal Spotter has 7 subscribers and no recent videos. The source brings contact routes; the qualification rules still decide.

## Worth knowing
- Apple's podcast search doesn't filter by country of the creator, so expect a mix. The engine's country and activity rules filter them out.
- Qualified is still 3. Feed emails help only when the same lead also passes country, activity, entity and need, and that will show over the next days of cycles.
