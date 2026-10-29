# AI agent page: clearer layout, wording and run states

**Date:** 2026-10-29
**Files:** `app/agent/page.tsx`, `app/agent/run-panel.tsx`, `app/agent/proposal-card.tsx`, `app/agent/copy-button.tsx` (new)

## Why
You asked for the AI agent page to look more realistic, with care for the type and the content. Several things on the page didn't match reality:
- **A run stuck on "running · 0 s":** it was started at 14:35 and still unfinished 26 minutes later, and "0 s" was wrong.
- **Raw errors** such as "socket hang up".
- **"Ollama… loaded, free and local" ticked green,** while the last runs on it had all failed or timed out.
- **Groq and Gemini keys set but unused:** `AGENT_PROVIDER=ollama`, so the agent runs on the slow local model.
- **Mixed type:** different sizes and weights for the same kind of text, setup rows named after env variables, a ✓/! character instead of icons, and "0 available" in amber on every empty source.

## What changed
**Header**
- One plain paragraph says what the agent does and that nothing is sent until you approve it.
- On the right, a status pill shows the model in use (green if ready, amber if struggling, red if not set up).

**"The local model is too slow on this computer"**
- An amber notice appears only when the agent is on Ollama and a recent run timed out or lost the connection.
- When Groq or Gemini keys are set, it says so and offers **Copy AGENT_PROVIDER=free** with where to put it. Nothing is changed for you.

**New run card**
- Sources are selectable tiles: name, what the agent does with it, and the count in large type ("3 leads", "nothing yet").
- A labelled "Focus (optional)" box, and "Up to [10] proposals".
- The demo-lead checkbox only appears when demo leads exist.
- **While running,** the button says Working… and a line says how long it usually takes and that you can leave the page.
- **Results** say "Finished in 12 s with 3 proposals, waiting for your review below", or show the failure in red.
- The not-ready box keeps the copy-the-fix button and **Check again**.

**Setup card**
- Plain names with icons: **Model**, **Your sender details**, **Email delivery**, **Test mode**.
- Each says what it means in practice, for example "no RESEND_API_KEY: approved emails are saved as drafts".
- The Model row is amber when Ollama is running but too slow, instead of a green tick.

**Waiting for your review**
- A count, and an empty state that explains what will appear there and that messages can be edited before approving.

**Recent runs**
- One row per run: an icon with **Done / No proposals / Failed / Running / Interrupted**, the source names ("Qualified leads, Pipeline"), when, how long, proposals, cost and model.
- **Running** shows the time so far.
- **Interrupted:** a run still marked running after an hour will never finish, for example after a dev-server restart, and it says so.
- **Errors in plain words,** with the original on hover:
  - "took over 900 s" → "The local model took too long on one step… use AGENT_PROVIDER=free";
  - "socket hang up" → "Lost the connection to the model server…";
  - all providers resting → "try again later (see AI usage)".

**Recent decisions:** a list with when each was decided.

**Type:**
- The app's Geist font is kept, with one scale: page title 2xl semibold, card and section titles base semibold, body sm with line height 6, details xs grey, tabular figures for numbers.
- The proposal card got the same: more padding, a 6-unit line height on the rationale and the message box.

**Unchanged:** the agent itself, its tools and guardrails, the approve and reject actions, and the environment settings.

## Checked
- **Type-check,** `next build` (`/agent` compiled) and 93/93 tests.
- **The run data the page shows,** from `agent_runs`:
  - the 14:35 pipeline run (running, 26 min so far at 15:01; marked Interrupted after an hour);
  - the 14:26 run ("took over 900 s");
  - the 12:56 run ("socket hang up");
  - three runs with no proposals.
- **Not seen in the browser:** the page needs your sign-in. The browser pane is on the sign-in page.

## Note
- **The other files:** `app/agent/page.tsx` and `run-panel.tsx` had uncommitted changes from outside this session (`docs/changes/2026-10-29-agent-page-fixes.md`). Their ideas are kept: counts per source, the "no proposals" state, durations like "21m 55s", model notes with `<think>` removed, and the copy-the-fix button.
- **The 14:35 run is still marked running.** It may still be working on Ollama, which uses the CPU. I didn't stop it.
