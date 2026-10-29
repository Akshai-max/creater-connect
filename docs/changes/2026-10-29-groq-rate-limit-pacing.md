# Pace Groq calls from its rate-limit headers

**Date:** 2026-10-29
**Files:** `lib/llm/router.ts`, `tests/llm-router.test.ts`, `README.md`

## Why
You exported Groq's request log for the day (195 requests from 10:21 to 10:40 UTC) and flagged the errors:

| Count | Error | Cause |
|---|---|---|
| 78 | 429 `rate_limit_exceeded` on tokens per minute (limit 8,000) | the entity check sent requests faster than the free tier allows |
| 1 | 404 `llama-3.3-70b-versatile` does not exist | the retired default model, already replaced by `openai/gpt-oss-120b` |
| 1 | 400 `reasoning_effort` must be low, medium or high | a one-off manual probe of the value `none`; the app sends `low` |
| 1 | 400 `json_validate_failed` | reply limit too small for a reasoning model, already raised to 800 |

The 429s cost no data: the run waited each time and finished with 0 errors. But 40% of requests were refused, and they cluttered the logs on both sides.

## What changed
- **The router reads the headers Groq returns on every reply:** tokens left this minute (`x-ratelimit-remaining-tokens`), the limit (`x-ratelimit-limit-tokens`), the refill time (`x-ratelimit-reset-tokens`), and the remaining requests with their reset time.
- **Before the next call to that provider,** it estimates the request size (about 4 characters a token, plus 200 for the reply). If not enough tokens are left, it waits for them to come back and then sends.
- **The wait covers only the missing share.** `reset-tokens` is the time until the whole 8,000 is back, often around 28 s, but tokens refill steadily. So the router waits for the share this request needs, which matches Groq's own "try again in 2.4 s".
- **Waits over 20 s aren't paced,** for example when the daily cap of 1,000 requests is used up. Those are left to the normal 429 handling: rest, then the next provider.
- **Providers that send no such headers** are unaffected.

## Checked
- **Unit tests:** 78/78, plus type-check. The tests cover duration parsing ("7.66s", "2m59.56s", "292.5ms"), a wait when the budget is low, no wait when plenty is left, and Groq's real header shape (28 s for the full window, so wait only about 0.7 s).
- **Real Groq, 24 entity-sized calls back to back:**

| | 429s | Result |
|---|---|---|
| before the change | 78 of 195 in the real entity-check run | run finished, but 40% of requests refused |
| first version (waited for the full refill) | 1 of 24 | the 28 s refill time was over the cap, so one call was refused |
| fixed | **0 of 24** | 24 ok in 20.5 s |

## Worth knowing
- **Free-tier limits** on `openai/gpt-oss-120b`: 8,000 tokens a minute and 1,000 requests a day. An entity check uses about 550–750 tokens, so the limit is roughly 10 to 14 checks a minute.
- **The 1,000-request daily cap:** 870 were left at 11:01 UTC. When it runs out, the router switches to Gemini until Groq resets.
