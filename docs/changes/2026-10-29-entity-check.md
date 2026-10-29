# Entity check: a model points at the creator's own words, code verifies

**Date:** 2026-10-29
**Files:** `lib/leads/entity.ts`, `scripts/classify-entities.ts`, `lib/leads/types.ts`, `lib/leads/normalize.ts`, `lib/leads/repo.ts`, `lib/leads/discovery.ts`, `lib/db/schema.ts` (comment), `tests/entity.test.ts`, `package.json`

## Why
Every discovered lead starts as `entity_type = needs_review`, because a person has to confirm it's an individual creator and not an agency, brand or publication. With hundreds of leads, that was the step blocking every one of them. You asked for a model to make that call.

The AI agent couldn't do it on Ollama. Its two runs took 22 and 27 minutes for 2 turns and made 0 proposals: on a laptop CPU the model needs about 10 minutes to read the agent's large prompt, and qwen3:4b answered in prose instead of calling tools.

## What changed
`npm run classify-entities -- --in <csv>` asks a model **one short question per row**. It sends the channel name, the description (capped at 900 characters) and 8 video titles, and gets back JSON only (`entity` and `quote`).

**The model can't decide alone.** Code accepts an answer only when:
1. The quote appears **word for word** in the creator's own text (channel name, description or video titles), ignoring case, spacing and curly quotes. A paraphrase or invented quote is rejected.
2. The quote **says who runs the channel**:
   - for `individual`: "I'm…", "I am…", "I help / teach / coach…", "my show / channel / podcast…", "hosted by…", "co-host…", "join me…";
   - for `agency`, `brand` or `publication`: "agency", "we are a…", "company", "network", "magazine", "official channel"…
   A real but irrelevant quote, such as a video title ("Hunter Biden is Packing") or a slogan ("It's never too late to Pivot!"), is rejected.
3. Anything else (`unsure`, an unknown answer, either check failing) leaves `needs_review` with an `entity_note` explaining why.

"I was…" and "my story" were deliberately **not** added. A studio can write its founder's story in the first person (Dhar Mann), and the brief favours missing a creator over counting a company.

**Recorded on the lead:**
- `entity_evidence_url` (where the quote is), `entity_quote`, `entity_source = ai:<provider>/<model>`;
- stored as an `entity` evidence item, with `source` set to the model.

The creator's words are the evidence; the model only points at them.

**Never overrides a person.** Rows with an `entity_type` other than `needs_review` are skipped.

**Only where it matters.** Each row is first run through the engine's own rules with `entity_type=individual`. If it would still be rejected (inactive, wrong country…), no model call is made. On 275 channels, 121 needed the check and 154 were skipped.

**Resumable.** Raw answers are cached in `data/entity-cache.json` with the model that gave them, so a rerun continues and rule changes apply without asking again. The CSV is also written when a run stops early.

**Discovery keeps `channel_description`** (up to 1,500 characters), so the check needs no extra YouTube quota.

## Result (Ollama, qwen3:4b, before the router)
- **Speed:** about 15 s a row when the CPU was free. It slowed to 100+ s and timed out while an AI agent run (started from the AI agent page at 08:13) held the model, because Ollama answers one request at a time.
- **Results:** the run was stopped at 72 of 121 rows, with 20 confirmed individuals, 50 sent for review and 1 excluded. Examples:
  - **confirmed:** Jay Shetty ("I'm Jay Shetty host of On Purpose…"), You Should Know Podcast ("hosted by Peyton Hardin and Cameron Kennedy"), Kartik Dhiman ("I am Kartik Dhiman, a Business Coach…");
  - **sent for review:** CONO and The Pivot Podcast (irrelevant quotes), and Profitable Tradie ("We're one of the world's leading business coaching…").
- **A problem found:** the model sometimes copied the example quote from the instructions. The quote check caught it, and the example was removed from the prompt.

The remaining rows run through the [LLM router](2026-10-29-free-llm-router.md) once a Groq or Gemini key is set.

## Tests
`tests/entity.test.ts`: quote location, paraphrases and short quotes rejected, quotes that don't say who runs the channel rejected, the prompt's own patterns can't be used as evidence, a story line alone doesn't prove a person, unknown answers, the prompt length cap, and the entity columns reaching the engine input.
