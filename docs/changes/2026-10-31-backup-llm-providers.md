# Backup LLM provider: OpenRouter free models

**Date:** 2026-10-31
**Files:**
- `lib/llm/router.ts`
- `app/ai-usage/page.tsx`
- `lib/env-check.ts`
- `.env.example`
- `tests/llm-router.test.ts`
- `.env.local` (not in git)

## Why
The entity check stalled with "no LLM provider available": Groq's daily quota was used up and Gemini was resting, with 1,233 leads waiting. You asked for more free models as backups.

## What changed
- **OpenRouter is a third hosted provider.** The order is now `groq,gemini,openrouter,ollama`, set in both the default and your `.env.local`.
  - Key: `OPENROUTER_API_KEY` (openrouter.ai/keys).
  - Model: `OPENROUTER_MODEL`, optional.
- **`OPENROUTER_MODEL` takes a comma list.** The router sends it as OpenRouter's `models` fallback list, so when one free model is "temporarily rate-limited upstream", OpenRouter answers with the next one in the same request. The default is `nvidia/nemotron-3.5-super-vl:free,google/gemma-4-31b-it:free,dots-studio/dots-3-note-preview:free`:
  - all three are free models that list JSON-output support;
  - each was tested on its own;
  - dots-3 follows instructions least well, so it's last.
- **No `reasoning_effort` for OpenRouter.** It goes only to Groq and Gemini.
- **OpenRouter's daily cap** ("free-models-per-day") counts as a daily quota.
- **The router is table-driven.** Hosted providers are a table (`HOSTED`: env prefix, sign-up page, whether `reasoning_effort` is accepted), so adding another one later is one entry.
- **The AI usage page** shows every provider. A missing one says where to get its key; a key set but left out of `LLM_PROVIDERS` says to add it.
- **`npm run check-env`** warns when a key is set but its provider isn't in `LLM_PROVIDERS`.

## Tried and removed: Cerebras and Mistral
- **Cerebras.** Its key line held the YouTube API key, identical to `YOUTUBE_API_KEY`, so it answered 401 "Wrong API Key", and a real `csk-` key never arrived. Removed.
- **Mistral.** No key; its free tier also needs you to agree that Mistral may train on the prompts. Removed.
- **Cleanup.** Both are gone from the code, `.env.example` and `.env.local`. The `.env.local` line with the duplicate YouTube key is deleted; a copy from before is in `data/backups/env.local.before-remove-cerebras`.

## Pause times
When OpenRouter's free models are busy, the reply has no `retry-after` header and no retry time in the body. The router then rests it for 60 s and labels that "estimated" on the AI usage page.

## Checks
- `npx tsc --noEmit` is clean; `npm test`: 110/110 pass.
- The new test checks the provider order, that OpenRouter gets no `reasoning_effort`, that it gets JSON mode, and that it gets a fallback list whose first entry is the requested model.
- `npm run llm-check` against the real services:
  - **Groq** OK (1.3 s);
  - **Gemini** out of today's quota;
  - **OpenRouter** OK (1.1 s, and earlier 3.0 s and 2.1 s);
  - **Ollama** OK.
- Only `:free` models cost nothing on this OpenRouter account, even though the key can reach 654 models.
