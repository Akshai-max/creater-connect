# Change notes

One file per change: why it was made, what changed, how it was checked, and anything you'll notice. Newest first.

| Date | Change |
|---|---|
| 2026-10-31 | [Local Postgres in Docker](2026-10-31-local-postgres.md): Neon's 64 MB response limit broke the engine at ~5,300 leads; all data copied to a local Postgres 18.6 (row counts identical), Neon kept as backup, `npm run db:backup` |
| 2026-10-30 | [Engine 24/7, one step per key](2026-10-30-run-247-one-step-per-key.md): the task runs on battery and catches up after sleep; a new key's 100 searches go in one step |
| 2026-10-30 | [Catch-up and bigger discovery steps](2026-10-30-catch-up.md): `npm run catch-up` works through the contact and entity backlog under the cycle lock; 50 searches a step, channels up to the key's remaining units; qualified 38 → 50 |
| 2026-10-30 | [Provider values, not guesses](2026-10-30-provider-values-not-guesses.md): pause times from the providers' replies, YouTube's quotaExceeded believed over the app's count, entity check with video descriptions |
| 2026-10-30 | [Half-emoji save error fixed](2026-10-30-half-emoji-save-error.md): shortened titles cut emoji in half, so the database rejected the lead ("unexpected end of hex escape"); every saved string is now valid text |
| 2026-10-30 | [Quota counted like Google does](2026-10-30-full-quota-per-key.md): 100 searches + 10,000 units per key, 10 searches (~930 units) a step, cheap sources keep going, Engine page shows both |
| 2026-10-30 | [Cycle runs hidden, contact-finder hang fixed](2026-10-30-cycle-runs-hidden-and-contact-hang-fix.md): no console window, linear email scan (a 1.5 MB page held a CPU core 20 min), 6-min budget, killed cycles no longer leave a blocking lock |
| 2026-10-30 | [Quota counter resets on a new YouTube key](2026-10-30-reset-quota-counter-on-new-key.md): a changed key restarts the daily unit counter instead of showing "quota used" |
| 2026-10-29 | [Website contact finder](2026-10-29-website-contact-finder.md): business emails from creators' own sites and link pages (robots.txt honoured, never guessed); qualified and Priority A 6 → 10 |
| 2026-10-29 | [AI agent page redesign](2026-10-29-agent-page-redesign.md): status pill, slow-local-model notice, source tiles, plain setup rows, run states incl. interrupted, errors in plain words, one type scale |
| 2026-10-29 | [AI agent page fixes](2026-10-29-agent-page-fixes.md): counts per source, "no proposals" state, readable durations, model notes without reasoning, copy-the-fix button |
| 2026-10-29 | [Discovery: 500 per step](2026-10-29-discovery-500-per-step.md): `--max-new 500`, 12 searches a step, entity check capped at 150 model calls a cycle (limit now counts calls, not rows) |
| 2026-10-29 | [More discovery per day](2026-10-29-more-discovery-per-day.md): search every 20 min instead of 40, 2 searches and 25 featured lookups per step, same 7,000-unit cap |
| 2026-10-29 | [Leads: New tab](2026-10-29-leads-new-tab.md): leads added in the last 2 h / 24 h / 7 days, newest first, with an Added column |
| 2026-10-29 | [Leads page UI](2026-10-29-leads-page-ui.md): search, country filter, sortable headers, tab counts, a Why column, validation checklist |
| 2026-10-29 | [Guest links and Apple Podcasts](2026-10-29-guest-links-and-apple-podcasts.md): YouTube links in video descriptions (1 unit a handle), podcast directory + RSS feeds with the owner email as a reviewed contact route |
| 2026-10-29 | [Engine page layout](2026-10-29-engine-page-ui.md): status banner, today's tiles with quota bar, 6-column run table with a lead-mix bar |
| 2026-10-29 | [Engine page shows discovery](2026-10-29-engine-page-discovery.md): Discovery column (+N new with sources, or no search · next HH:MM), next search and daily units, discovery units counted in run cost |
| 2026-10-29 | [Lead evidence summarised](2026-10-29-lead-evidence-summary.md): facts tiles, video summary + 5 newest (newest first) with "Show all", one-line contact routes, text as links |
| 2026-10-29 | [Lead detail page layout](2026-10-29-lead-detail-ui.md): plain header, key-number tiles, step timeline for drafts, grouped evidence, compact contact routes |
| 2026-10-29 | [Discovery finds fewer repeats](2026-10-29-discovery-fewer-repeats.md): newest-video search, worn-out searches dropped, 3 regions × 16 searches, featured channels (43/43 and 12/12 new vs 10/50) |
| 2026-10-29 | [Sticky sidebar](2026-10-29-sticky-sidebar.md): the menu stays on screen when a long page scrolls |
| 2026-10-29 | [Cycle finds and checks new channels](2026-10-29-cycle-discovery-and-entity-check.md): depth-first YouTube searches every 2 h (≤ 4,000 units a day), entity check on new rows |
| 2026-10-29 | [Engine runs every 20 minutes](2026-10-29-engine-every-20-min.md): Windows scheduled task, 30-channel refresh slice per run, lock and cursor |
| 2026-10-29 | [AI usage page redesign](2026-10-29-ai-usage-redesign.md): one-line status, grouped switches, plain-language problems, call log collapsed |
| 2026-10-29 | [Ollama live status](2026-10-29-ollama-live-status.md): the AI usage page says "unreachable" or "model missing" instead of "available" |
| 2026-10-29 | [Gemini Flash Lite](2026-10-29-gemini-flash-lite.md): 500 requests a day instead of 20, retry hint read, saved rests per model |
| 2026-10-29 | [Pace Groq from its rate-limit headers](2026-10-29-groq-rate-limit-pacing.md): waits for tokens to refill instead of getting 429s (78 → 0) |
| 2026-10-29 | [First run on Groq and Gemini](2026-10-29-first-free-llm-run.md): current models, 400s don't bench, waits out per-minute limits, 3 qualified (all A) |
| 2026-10-29 | [Free LLMs with automatic failover](2026-10-29-free-llm-router.md): Groq → Gemini → Ollama, switches when a quota runs out, AI usage audit page |
| 2026-10-29 | [Entity check](2026-10-29-entity-check.md): a model points at the creator's own words, code verifies the quote |
| 2026-10-29 | [Stop logging Server Function arguments](2026-10-29-hide-server-function-args.md): the dev log printed login passwords |
| 2026-10-29 | [Leads page pagination](2026-10-29-leads-pagination.md): counts and paging in the database, 50 per page, 4.3 MB → 35 KB per load |
| 2026-10-29 | [Observed need signals](2026-10-29-observed-need-signals.md): captions, repurposing and consistency read from channel data, labelled "observed" |
| 2026-10-29 | [First real discovery run](2026-10-29-first-real-discovery-run.md): YouTube key verified, 275 channels, why 0 qualify yet |
| 2026-10-29 | [Remove demo data](2026-10-29-remove-demo-data.md): `npm run purge-demo`, with a backup |
| 2026-10-29 | [Primary language detection](2026-10-29-language-detection.md): from YouTube's own language settings |
| 2026-10-29 | [Login hardening](2026-10-29-login-session-hardening.md): hashed cookie, no open app in production, safe redirects |
| 2026-10-29 | [`/api/discover` auth and Apify gate](2026-10-29-discover-route-auth-and-apify-gate.md): closed in production, Instagram scraping off |
| 2026-10-29 | [Production env check](2026-10-29-check-env.md): `npm run check-env` |

Earlier changes are described in their commit messages (`git log`).
