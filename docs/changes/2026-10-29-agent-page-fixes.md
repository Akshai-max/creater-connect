# AI agent page fixes

Changed [app/agent/page.tsx](../../app/agent/page.tsx) and [app/agent/run-panel.tsx](../../app/agent/run-panel.tsx). No agent logic changes.

What was wrong, from the page itself:

- Two runs showed "succeeded" with 0 proposals after about 22 minutes, and the model's note said every tool returned empty arrays. There was simply nothing to work on (demo data had been removed), but the page gave no hint of that.
- The summary showed the model's reasoning ("Okay, let me try to figure out…") as the headline.
- Durations read "1315s".
- The Ollama-down message was one line of small text under a greyed-out button.

What changed:

- Each source checkbox shows how many items it has ("3 available"). If every selected source has none, the Run button is disabled with a reason, and a note offers the demo-lead checkbox when demo leads exist.
- A succeeded run with 0 proposals is badged **no proposals** (amber). Its model notes sit in a collapsible section, with `<think>` blocks removed, instead of being the headline.
- Durations read "21m 55s".
- When the model server isn't ready, an amber box shows the message, a button that copies the fix command (`docker compose up -d`, or `docker compose up ollama-pull` when the model isn't pulled), and a **Recheck** button.

I didn't start Docker or Ollama: a local model run is CPU-heavy.
