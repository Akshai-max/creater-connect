# AI usage page: check Ollama live instead of showing it "available"

**Date:** 2026-10-29
**Files:** `lib/llm/probe.ts` (new), `app/ai-usage/page.tsx`, `tests/llm-probe.test.ts` (new)

## Why
The Ollama card said **available** while its Docker container was stopped. The page judged each provider only from the `llm_calls` audit. A refused connection rests Ollama for just 30 s, so once that passed the page reported it available again, although nothing was listening.

## What changed
- **`probeOllama(baseUrl, model)`** asks the local Ollama for its pulled models (`GET /api/tags`, 1.5 s timeout) each time the page loads. The card now shows:
  - **unreachable**, with "Start it with: docker compose up -d ollama", when nothing answers;
  - **model missing**, with the `ollama pull` command, when Ollama runs but `OLLAMA_MODEL` isn't pulled;
  - otherwise **resting** or **available** as before.
- **Groq and Gemini are not probed live.** Every probe would spend free quota, so their state still comes from the audit (resting until…, last problem).

## Checked
- **`tests/llm-probe.test.ts`** runs a real local HTTP server and covers:
  - model present (`qwen3:4b`, and `llama3` matching `llama3:latest`) → up;
  - another model only → model missing;
  - a closed port → unreachable, with the start command.
- **The real machine now,** with the container stopped: `down: Not reachable at http://localhost:11434…`.
- **Overall:** 79/79 tests, type-check, and `next build` (`/ai-usage` compiled).
- **Not seen in the browser:** the page needs your sign-in.

## Note
Another session is redesigning the layout of `app/ai-usage/page.tsx` and has said it will keep this status logic.
