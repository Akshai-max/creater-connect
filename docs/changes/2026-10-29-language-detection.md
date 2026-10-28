# Primary language from YouTube's own settings

**Date:** 2026-10-29
**Files:** `lib/leads/discovery.ts`, `tests/discovery.test.ts`

## Why
The brief requires recent content to be "mainly in English". Discovery left `primary_language` empty, so every discovered lead failed the language check and needed a manual fill. In the first real run (10 channels), all 10 were blocked on language.

## What changed
`primaryLanguage(channel)` reads the language the creator set in YouTube. That data was already in the API responses discovery fetches, so this costs no extra quota:

1. `defaultAudioLanguage` (or `defaultLanguage`) on the 15 most recent videos. If at least 3 are labelled and one language has at least 60% of them, that language wins (`en-US`, `en-GB` → `en`).
2. Otherwise, the channel's `defaultLanguage`.
3. Otherwise empty, and the row keeps `CONFIRM: primary_language` in `review_notes`. Nothing is guessed from titles or text.

RSS-only discovery has no language data, so those rows stay empty.

## Result
On the same 10 real channels: 9 `en`, 1 `es`. The Spanish one is now rejected for a clear reason instead of sitting in "unverified".

## Tests
Majority rule, no clear majority (left empty), channel default fallback, RSS unknown.
