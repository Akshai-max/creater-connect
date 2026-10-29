# Discovery quota counter restarts when the YouTube key changes

**Date:** 2026-10-30
**Files:** `scripts/engine-cycle.ts`

## Why
After a new YouTube key was put in `.env.local`, the Engine page still said "Daily search quota used" and "Search quota today 82%, 5,734 of 7,000 units". The key was fine. That number is the app's own count of the units discovery has spent today (a cap of 7,000 of YouTube's 10,000), kept in `data/engine-cycle-state.json`. It belongs to the old key's quota and only reset at midnight US Pacific.

## What changed
- At the start of each discovery step, the cycle takes a fingerprint of `YOUTUBE_API_KEY` (the first 12 characters of its SHA-256, kept in the state file as `keyId`; the key itself is never stored).
- If the fingerprint differs from the saved one, the daily unit counter and the next-search timer restart, and the log says `[discover] YouTube key changed: daily unit counter reset (was N)`.
- The first run after this change only records the fingerprint; it never resets.

A new key doesn't always mean a new quota: a second key in the same Google Cloud project shares its 10,000 units a day. In that case YouTube answers with a quota error, discovery logs it and stops, and nothing breaks, but the cap no longer protects you. A key from a new account or project does have its own fresh quota.

## Checks
- `npx tsc --noEmit` is clean. `npm test` passes (104/104).
- The reset itself was done by hand once for the key change that prompted this (counter 5,734 to 0, backup in `data/engine-cycle-state.backup.json`). With the counter at 0, the next cycle ran a full discovery step on the new key: 12 searches, no quota errors, about 420 new channels (1,151 to 1,570 leads), 2,138 units counted.
- The fingerprint code path hasn't been run yet; the first scheduled cycle records the fingerprint, and the next key change will exercise the reset.
- The Engine page reads the latest run, so its quota tile updates when the next run finishes.
