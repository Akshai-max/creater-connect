# Use the providers' own values, not the app's guesses

**Date:** 2026-10-30
**Files:** `lib/llm/router.ts`, `lib/leads/discovery.ts`, `lib/leads/cycle-discovery.ts`, `lib/leads/entity.ts`, `scripts/classify-entities.ts`, `scripts/catch-up.ts`, `app/ai-usage/page.tsx`, `app/engine/page.tsx`, `tests/llm-router.test.ts`, `tests/cycle-discovery.test.ts`, `tests/entity.test.ts`

## Why
You asked the app to take its values straight from the providers instead of assuming them. Two places didn't.

**1. AI pause times were guessed.** The AI usage page said Gemini was "Paused until 12:29" and the entity check stopped with "no LLM provider available". Groq's real reply was:

> Rate limit reached … tokens per day (TPD): Limit 200000, Used 199455, Requested 581. Please try again in 15.552s.

The router only read "retry in" (Gemini's wording), not Groq's "try again in". With no time found, it parked both providers until midnight US Pacific (07:00 UTC), a time it worked out itself. `npm run llm-check` shortly after showed both answering.

**2. YouTube errors lost YouTube's reason.** A failed call kept only "search HTTP 403", so the app couldn't tell "quota used" from anything else and relied on its own count.

## What changed
**AI providers (`classifyFailure`)**
- **The pause length comes from the reply**, in every form the providers use:
  - a `retry-after` header;
  - "try again in 15.552s" (Groq);
  - "Please retry in 19h46m" (Gemini);
  - Gemini's RetryInfo `"retryDelay": "52s"`.
- **This applies to daily limits too,** even when the time is short: Groq's tokens-per-day limit is a rolling window, so its 15 s is right.
- **Only when the reply gives no time** does the router estimate (midnight US Pacific for a daily limit, 60 s otherwise). It marks that in the stored error ("the reply gave no retry time; estimated…") and `retryFrom: "estimated"`.
- **The AI usage page says which it was:** "Groq said to retry at this time", or "Groq didn't say when to retry, so this time is an estimate".

**YouTube**
- **Errors keep YouTube's reason,** for example "search HTTP 403 quotaExceeded" (`youtubeError`, `isQuotaExceeded`).
- **When YouTube says the quota is used, discovery believes it over its own count:**
  - a refused search marks today's searches as used and stops searching;
  - a refused channel fetch marks the units as used and keeps the found channels for the next key;
  - the step doesn't fail, and the other sources carry on. The step log says "YouTube says this key's search quota for today is used (…)".
- **The Engine page labels the quota card "app's count".** A tooltip explains that an API key can't read YouTube's own count (that's in Google Cloud → YouTube Data API v3 → Quotas), and a line appears when YouTube has replied that the quota is used.
- **Today's counters** were set earlier from your Google Cloud quota screenshot (41 searches, 2,212 units), the provider's own figures, plus the cycle that ran after it.

**Entity check: the creator's own video descriptions**
- New `--with-descriptions` option (the catch-up uses it): for leads that would qualify if confirmed as individuals but whose titles didn't say who runs the channel, it fetches their recent video descriptions (about 2 YouTube units each) and asks again.
- The quote must still appear word for word, and a quote from a description points at that video.

## Checked
- **Tests:** 109/109, type-check, `next build`. New tests cover:
  - Groq's real TPD reply → paused 15.552 s, `provider`;
  - Gemini's `retryDelay` → 52 s;
  - no time in the reply → 60 s, marked as an estimate;
  - YouTube's 403 `quotaExceeded` on a search → searches marked used, no failure, featured channels still added;
  - a quote in a video description located with that video's URL.
- **`npm run llm-check` on real APIs:** ✓ Groq `openai/gpt-oss-20b` (2.6 s), ✓ Gemini `gemini-3.5-flash-lite` (4.3 s). Both were available while the app had them parked until 07:00 UTC.
