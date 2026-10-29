# Change notes

One file per change: why it was made, what changed, how it was checked, and anything you'll notice. Newest first.

| Date | Change |
|---|---|
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
