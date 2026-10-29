# AI usage page: summary first, raw details hidden

**Date:** 2026-10-29
**Files:** `app/ai-usage/page.tsx`

## Why
The page showed raw provider output: JSON error bodies, UTC timestamps like `2026-10-29T10:34:37.835Z`, and one line for every switch, so 13 near-identical lines. It took reading the whole page to answer the one question that matters: is the AI working right now?

## What changed
- **Status banner** at the top, in one sentence:
  - "Healthy: groq is answering", or
  - "Running on backup: gemini is answering" (with why the primary is out), or
  - "No provider can answer right now".
- **Four numbers** for the last 24 h: answered, handled by a backup, retried attempts, tokens used.
- **Provider cards**:
  - Each card shows the provider's role (Primary, Backup 1, Backup 2) and a plain state: Ready, Paused until 16:04, Not running, Model missing, or Not set up.
  - It shows a success-rate bar and a "Problems" line that counts failures by type, such as "Rate limit (82), Wrong answer format (1)".
  - A fix hint appears when the provider can't be used, such as "Start it with: docker compose up -d ollama".
  - The Ollama live probe and the badge priority (not set up, then unreachable, then model missing, then paused, then ready) are kept from [Ollama live status](2026-10-29-ollama-live-status.md).
- **Automatic switches are grouped by route**, so 13 lines become one: "groq → gemini · 13 times · Paused after a limit (10), Rate limit (2), Wrong answer format (1) · last 40 min ago".
- **The call log is collapsed** under "Recent calls (latest 30, for troubleshooting)". It has plain columns: time, task, provider, result and time taken. The raw provider error is still in the tooltip on the result cell.
- Times are shown in local time and as "x min ago", never as raw UTC.

No data, queries or router behaviour changed; it's display only.

## Checks
- `npx tsc --noEmit` is clean.
- Checked in the browser after signing in (see the session).
