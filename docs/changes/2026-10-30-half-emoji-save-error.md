# Fix "could not parse the HTTP request body: unexpected end of hex escape"

**Date:** 2026-10-30
**Files:** `lib/leads/messages.ts`, `lib/leads/repo.ts`, `tests/outreach.test.ts`

## What you saw
Every engine run on the Engine page showed "1 error · 1 failed":

```
L-F085EA79F5: could not parse the HTTP request body: unexpected end of hex escape at line 1 column 4559
```

## Cause
Email subjects and the first message quote the creator's latest video title. Long titles are shortened to fit, with "…" at the end. The shortening counted text in UTF-16 units, so it could cut between the two halves of a character that takes two units: emoji (🤯, 🙏) and styled letters such as 𝐒𝐞𝐥𝐥𝐢𝐧𝐠. Half a character is not valid text, and the database's HTTP API rejected the whole save for that lead, so its latest data was never stored.

An offline pass over all 4,393 rows found 5 broken strings in 4 leads (L-F085EA79F5, L-6FD6226AC6, L-2341475543, L-38BFD2FC49), all email subjects or first messages. Only L-F085EA79F5 showed in the runs, because the others' broken text sat in drafts that hadn't been saved yet.

## What changed
- **`clip()` in `messages.ts`** drops a dangling first half of a character before adding "…". A cut title now ends "…Job Kyun?…" instead of "…Job Kyun? \ud83e…".
- **Safety net in `repo.ts`.** Every string in a lead, evidence or message row is passed through `toWellFormed()` before saving, so any future half character becomes � instead of failing the save.
- **New test.** It moves emoji and styled letters across every cut point (title prefixes of 20 to 120 characters) and checks that no subject, body, hook or first message contains half a character. It fails on the old code and passes with the fix.

## Checks
- `npx tsc --noEmit` clean; `npm test`: 107/107 pass.
- The 4 affected leads were saved with the fixed code straight away, including L-F085EA79F5.
- A full engine re-run wasn't done here: the other session's `catch-up` script held the cycle lock. The next scheduled cycle runs the fixed code, and its "failed" count should be 0.
