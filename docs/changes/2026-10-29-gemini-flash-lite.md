# Gemini: switch to Flash Lite (500 a day), read its retry hint, rests per model

**Date:** 2026-10-29
**Files:** `lib/llm/router.ts`, `lib/agent/config.ts`, `.env.example`, `README.md`, `tests/llm-router.test.ts`

## Why
The Gemini rate-limit page (free tier, last 28 days) showed "You have reached a rate limit":

| Model | Requests a minute | Tokens a minute | Requests a day |
|---|---|---|---|
| Gemini 3.6 Flash | **5 / 5** | 1.98K / 250K | **21 / 20** |
| Gemini 3.5 Flash Lite | 3 / 15 | 33 / 250K | 3 / 500 |
| Gemini 3.8 Flash | 1 / 5 | 11 / 250K | 2 / 20 |

`gemini-3.5-flash`, the default since this morning, is served by **Gemini 3.6 Flash**, according to Google's error: "limit: 20, model: gemini-3.6-flash". The free tier gives that model 5 requests a minute and 20 a day, which the entity check used up. As a fallback, Gemini was only useful a few times a day.

## What changed
- **Default `GEMINI_MODEL` → `gemini-3.5-flash-lite`:** 15 requests a minute and 500 a day on the free tier, 25 times the daily allowance. It returns the same JSON answers (checked with the router and `npm run llm-check`). Set `GEMINI_MODEL` to go back.
- **Gemini's retry hint is read.** Gemini sends no `retry-after` header, but its 429 message ends with "Please retry in 12.3s" (per minute) or "…in 19h46m2.9s" (per day). The router now uses that, rather than a flat 60 s for per-minute limits or a computed Pacific midnight for daily ones.
- **Saved rests are per model.** A rest saved in `llm_calls` now applies only while the provider uses the model that earned it. Before, the used-up 3.6 Flash quota would have benched Gemini until tomorrow, even after switching to Flash Lite.

## Checked
- **The real 429 from the used-up model** is classified as `quota_exhausted`, resting about 19.8 h, which matches Google's "retry in 19h46m".
- **Flash Lite through the router,** with saved rests honoured: `{"ok":true}`. No active rests.
- **`npm run llm-check`:** ✓ groq `openai/gpt-oss-120b`, ✓ gemini `gemini-3.5-flash-lite`.
- **Tests:** 78/78, plus type-check. New assertions cover Gemini's per-minute and per-day retry hints.

## Worth knowing
- **The daily counts reset at midnight US Pacific.** The 3.6 Flash quota stays used up until then, but Flash Lite isn't affected.
- **Free daily allowance now:** about 1,000 calls on Groq plus 500 on Gemini. The 121-row entity check used about 120.
