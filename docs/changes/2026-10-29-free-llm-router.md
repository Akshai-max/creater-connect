# Free LLMs (Groq, Gemini) with automatic failover and an audit page

**Date:** 2026-10-29
**Files:** `lib/llm/router.ts`, `lib/llm/agent-loop.ts`, `app/ai-usage/page.tsx`, `scripts/llm-check.ts`, `lib/db/schema.ts` (`llm_calls`), `lib/leads/entity.ts`, `scripts/classify-entities.ts`, `lib/agent/agent.ts`, `lib/agent/config.ts`, `app/agent/page.tsx`, `components/sidebar.tsx`, `lib/env-check.ts`, `.env.example`, `tests/llm-router.test.ts`, `tests/llm-agent-loop.test.ts`

## Why
Ollama on a laptop CPU is too slow: 15–100 s per entity check, and the AI agent made no proposals at all. It also slows the machine down while gaming. You asked to use the **Groq and Gemini free tiers**, to **switch automatically when one runs out of quota**, and to **show an audit** of it.

## What changed

### Router (`lib/llm/router.ts`)
- Tries providers in `LLM_PROVIDERS` order (default `groq,gemini,ollama`) and skips any without a key.
- Groq and Gemini use their OpenAI-compatible chat endpoints; Ollama is the local last resort.
- Classifies every failure, writes it to `llm_calls` with a rest period, and tries the next provider:
  - **daily quota** (429 that says per day, daily, PerDay, TPD or RPD): rests until midnight US Pacific, or the provider's `retry-after`;
  - **rate limit** (other 429): `retry-after`, else 60 s;
  - **key rejected** (401/403) or **model not found** (404): 1 h, this run only, because the fix is changing `.env.local`;
  - **5xx or network**: 30 s;
  - **unusable reply**: `invalid_output`, then the next provider.
- Rests from limits and outages are read back from `llm_calls`, so a used-up quota stays skipped across runs until it resets. A successful call clears a rest.
- When every provider is resting, it raises `AllProvidersUnavailable` with the time the first one is free again. The entity check then stops cleanly, keeps what it has done, and says when to rerun.

### Uses
- **Entity check**: every call now goes through the router. `entity_source` records the provider and model, for example `ai:groq/llama-3.3-70b-versatile`.
- **AI agent**: `AGENT_PROVIDER=free` runs the same tools and guardrails on Groq or Gemini (hosted only). A run can switch provider between turns, carrying the whole conversation over; the run summary lists the providers used.

### Audit
- **Table `llm_calls`** (additive, created with `drizzle-kit push`, which showed only `CREATE TABLE` and two `CREATE INDEX`): time, purpose, subject, provider, model, status, HTTP status, latency, tokens, error, rest-until, and which providers were skipped first.
- **The AI usage page** (sidebar, `/ai-usage`):
  - per provider: available, resting until…, or not configured; last-24-hour calls, ok, failed, tokens and average latency; last problem;
  - **automatic switches**: "answered by gemini after groq (quota_exhausted: …)";
  - **call log**: the latest 100 calls.
- **`npm run llm-check`**: one tiny call per provider, ignoring rests, prints ✓ or the exact reason (bad key, wrong model, rate limit, quota).
- **`npm run check-env`**: warns when no hosted LLM is set, or only one (nothing to switch to).

## Checked
- **Unit tests** with a fake network and an in-memory audit:
  - Groq's daily quota runs out → the same call answers on Gemini, Groq rests until Pacific midnight, and the next call doesn't try Groq;
  - a rest from an earlier run is respected;
  - unusable output falls through;
  - all resting → the caller learns when the first is back;
  - tool calls skip Ollama;
  - failure classification and the Pacific-midnight maths;
  - the agent loop switching mid-run with the full conversation.
- **Real Groq API** with a deliberately invalid key: "key rejected (HTTP 401) - check the API key… Invalid API Key", audited in `llm_calls`. That row doesn't bench Groq for the next run (active rests: none).
- **Overall:** 77/77 tests, type-check and production build (`/ai-usage` included).

## Not yet checked
- **Real calls:** now done. See [First run on Groq and Gemini](2026-10-29-first-free-llm-run.md), which also replaced the retired default models.
- **The page hasn't been viewed:** I can't sign in for you. Its queries were run directly against the database.
- **Default models** (`llama-3.3-70b-versatile`, `gemini-2.5-flash`) can be retired by the providers. A 404 is reported as "model not found - set GROQ_MODEL / GEMINI_MODEL".
- **Free-tier data use:** Google may use free-tier Gemini inputs to improve its products. Only public channel text is sent.
