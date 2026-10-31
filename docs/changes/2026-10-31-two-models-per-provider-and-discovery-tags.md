# Two free models per provider, and tags showing which search found each lead

**Date:** 2026-10-31
**Files:**
- `lib/llm/router.ts`
- `app/ai-usage/page.tsx`
- `scripts/llm-check.ts`
- `lib/leads/cycle-discovery.ts`
- `scripts/discovery-yield.ts` (new)
- `package.json`
- `.env.example`
- `tests/llm-router.test.ts`, `tests/cycle-discovery.test.ts`
- `.env.local` (`GEMINI_MODEL` line only)

## Why
You asked for 500 more valid leads. The numbers (62 qualified, 2,346 unverified, 4,959 rejected) show two limits:
- **The entity check runs out of free AI quota.** 1,745 leads still need it.
- **Most channels found get rejected.** The reasons are low upload activity (3,784), country (1,528) and language (1,033), and nothing showed which searches bring the good ones.

The `npm run catch-up` started alongside this works through the near-qualified backlog. This change raises its AI capacity and starts measuring discovery.

## What changed
- **Several models per provider, each with its own quota.**
  - `GROQ_MODEL` and `GEMINI_MODEL` take a comma list, and each model becomes its own entry, tried in order.
  - Defaults: Groq `openai/gpt-oss-120b,openai/gpt-oss-20b`; Gemini `gemini-3.5-flash-lite,gemini-3.1-flash-lite`. Your `.env.local` `GEMINI_MODEL` now lists both.
  - Rests, rate budgets and "a later success clears the rest" are kept per provider **and** model (`slotOf`), so when the 120b model hits its daily limit the 20b keeps answering.
  - OpenRouter still sends its list in one request (OpenRouter's own fallback).
- **The AI usage page** shows one card per provider and model.
- **`npm run llm-check` allows 800 reply tokens, not 60.** Models that think first (Gemini 3.1-lite) ran out of 60 tokens before writing the JSON, which made a working model look broken.
- **`discovered_via` on every new lead.** The cycle records what found each channel:
  - `search:business coach|US`;
  - `videos:…|GB`;
  - `featured:UC…`;
  - `guest`;
  - `apple:marketing podcast`.

  A channel carried over to the next step keeps its tag.
- **`npm run discovery-yield`** joins those tags with each lead's status and lists every source by the share of its leads that are qualified or near-qualified (only a contact or the entity check missing). `--full` shows the exact tags. Leads found before today have no tag, so the report fills up as the cycle runs.

## Checks
- `npx tsc --noEmit` clean; `npm test`: 111/111 pass.
- New tests:
  - a used-up model rests while the provider's other model keeps answering, also when the rest is read back by a new router;
  - comma lists become separate entries;
  - discovery rows carry the right tag for searches, video searches, featured channels and carried-over channels.
- `npm run llm-check` against the real services: Groq 120b OK (1.2 s), **Groq 20b OK (0.5 s)**, Gemini 3.1-lite OK (1.9 s), OpenRouter OK (1.1 s). Gemini 3.5-lite is out of today's quota.
