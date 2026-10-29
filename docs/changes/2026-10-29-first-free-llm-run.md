# First run on Groq and Gemini: current models, fixes, first qualified leads

**Date:** 2026-10-29
**Files:** `lib/llm/router.ts`, `lib/leads/entity.ts`, `scripts/classify-entities.ts`, `lib/agent/config.ts`, `.env.example`, `README.md`, `tests/llm-router.test.ts`
**Data (git-ignored):** `data/discovered-2026-10-29.csv` (backup: `data/backups/discovered-2026-10-29.before-router-entity.csv`), `data/classify-router-2026-10-29.log`, `data/engine-router-2026-10-29.log`, `exports/leads.csv`

## Why
The Groq and Gemini keys were added to `.env.local`, and `npm run llm-check` failed on both. The keys were fine; the default models were retired.

## What changed
- **Default models updated** to ones the keys can use today. Each was listed by the provider's `/models` endpoint and answered a test call:
  - Groq: `llama-3.3-70b-versatile` → `openai/gpt-oss-120b`. The old model is gone from Groq's list.
  - Gemini: `gemini-2.5-flash` → `gemini-3.5-flash`. Google answered "no longer available to new users".
  - `GROQ_MODEL` / `GEMINI_MODEL` still override them.
- **`reasoning_effort: "low"` sent to Groq and Gemini.** Both new models think before answering, and with a small `max_tokens` the thinking used it all up, leaving an empty reply. Set `LLM_REASONING_EFFORT` to `medium`, `high` or `off` to change it.
- **The entity check allows up to 800 tokens** (was 200), for the same reason. Groq once returned HTTP 400 `json_validate_failed` with an empty generation.
- **HTTP 400 no longer benches a provider.** It's about one request, so it's logged as `invalid_output` and the next provider answers. Before this, one bad reply rested Groq for 5 minutes.
- **The entity check waits out short limits.** The free tiers allow only a few calls a minute (Gemini's free flash model gave 429 after 5 quick calls). When every provider is resting for 10 minutes or less, the script waits and carries on. A longer rest, such as a used-up daily quota, still stops the run cleanly. The wait is capped at 6 per row.

## Checked
- **`npm run llm-check`:** ✓ groq `openai/gpt-oss-120b` (about 4 s), ✓ gemini `gemini-3.5-flash` (about 1.5 s). Ollama ✗ (stopped on purpose, so the laptop stays free for gaming).
- **Tests:** 77/77 pass, plus type-check. New assertions cover the 400 classification and the reasoning-effort setting.
- **Failover seen on real APIs** (`llm_calls`, AI usage page): Gemini 503 "high demand", Gemini 429, Groq 429 per-minute limit and Groq 400. Each time the next provider answered, or the run waited a few seconds.

## Result
**Entity check:** 119 rows needed it (2 had been confirmed on the first attempt).

| | |
|---|---|
| checked | 115 by a model + 4 from cache, 0 errors, 0.9 s average |
| answered by | Groq 107, Gemini 8 |
| confirmed individual | 33 (35 including the first attempt) |
| excluded | 7: Think Media ("Our company…"), YouTube Creators ("YouTube's official channel…"), Unfinished Business ("Presented by Structured Agency…"), Discover Brightside, Content Creators, Canada's Entrepreneur, Dish Podcast |
| left for review | 79 (no quote that says who runs the channel) |

**Engine** (`run_20261029104032_8848`): **3 qualified, all Priority A**; 111 unverified, 161 rejected, 0 failed.
- JeffMara Podcast (US, 279K, score 94.0)
- Digital Social Hour Podcast by Sean Kelly (US, 1.3M, 90.8)
- The Grown Up Business Podcast (GB, 1,050, 86.9)

Each has a public email from its channel page and an observed captions need.

**Why the other 32 confirmed individuals didn't qualify:**
- **No public email:** 30 of them have no email in their channel data. The engine doesn't guess one.
- **Other gaps, often alongside the email:** missing monetisation signal (11), missing need (7) and missing country (5).

## Needs a person
- **The Grown Up Business Podcast:** the confirmed host is Paul Avins, but the email is `steve@` at a training company. Check who it reaches before any outreach.
- **Dish Podcast** was excluded from its sponsor line ("Brought to you by Waitrose…"). It has named hosts, so this is a cautious miss; switch it to `individual` by hand if you agree.
- **Export checks** flag the mix: 2 countries (need ≥ 3) and US at 67% (max 60%). Three leads are too few to balance.
- **No messages were sent.** The 27 sequence messages are drafts in the pipeline and still go through the review inbox.
