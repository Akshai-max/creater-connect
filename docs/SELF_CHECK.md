# Assessment self-check (updated 2026-10-27)

This maps the brief (*IncuBrix 2027 Growth Engineer, Option 1*) and the submission workbook's 7 minimums to what this repo actually does. IncuBrix recalculates every number from the files, so each status below is backed by a file or a command, and nothing is claimed that hasn't run.

**Status values:**
- **MET:** done and verified; the evidence is linked.
- **NOT MET:** the engine supports it, but the required result doesn't exist yet.
- **BLOCKED / YOU:** needs something only the candidate can provide.

## A. Workbook minimums (04_SELF_CHECK rows 6–12; all 7 must be MET)

| # | Minimum | Required | Current value | Status | Evidence / what's missing |
|---|---|---|---|---|---|
| 6 | Unique qualified creators (full leads.csv) | ≥ 1,000 | **0 real** | **NOT MET** | No permitted evidence source has been supplied yet (see C1). The 4 qualified fixture rows are fictional and are refused by `fill_workbook.py`. |
| 7 | Countries: ≥80% approved, ≥3 countries, none >60% | Yes | — | NOT MET (no rows) | Computed by `lib/leads/distribution.ts` and recalculated by `fill_workbook.py` |
| 8 | Final duplicates | 0 | 0 | Engine MET | `duplicate_check` uses the workbook vocabulary. The engine dedupes by stable id, canonical URL and contact. Tests: `tests/dedupe-export.test.ts`. |
| 9 | Outreach channels with ready sequences | ≥ 3 | 3 (Email, LinkedIn, Instagram) | Engine MET | `outreach/_SEQUENCES_BY_SEGMENT.md` (3 segments × 3 channels × 3 messages), test in `tests/engine.test.ts` |
| 10 | Priority A with first message + 2 follow-ups | ≥ 25 | 0 real | **NOT MET** | Generated automatically for the top 25 once 25 real leads qualify. Also needs `SENDER_*` in `.env.local`. |
| 11 | Seed test passed on 3 own channels | Yes | No | **BLOCKED / YOU** | Needs your own accounts in `SEED_TEST_ALLOWLIST` and `RESEND_API_KEY`. Run `npm run seed-test -- start`, send LinkedIn and Instagram by hand, click the links, reply, then `report --json`. |
| 12 | Engine reruns from README | Yes | Yes | **MET** | `npm run engine -- --input <file>`. Normal, repeat, refresh, failure and recovery runs are recorded in `engine_runs` (export with `--runs-json`). |

## B. Brief final checklist (PDF page 3)

| Item | Status | Evidence / notes |
|---|---|---|
| 5 product observations + 3 opportunities | **BLOCKED / YOU** | Needs your own use of the IncuBrix product (access is in the invitation email). Workbook tab 01_INSIGHT. |
| ≥1,000 qualified creators | **NOT MET** | See A6 |
| 25 Priority A leads with full sequences | **NOT MET** | See A10 |
| 3 channels | MET (engine) | See A9 |
| No duplicates | MET (engine) | See A8 |
| Seed test proof | **BLOCKED / YOU** | See A11 |
| Repeatable engine | MET | README › Lead engine, 33 tests passing |
| Launch kit | MET (draft) | `docs/LAUNCH_PLAN.md`. Rates are labelled as estimates. |
| Completed workbook | Partial | `npm run workbook` fills tabs 02, 03 and 04 from real files. Tab 00 personal details, tab 01, the declaration and the self-score are yours to fill. |
| leads.csv in the workbook format | MET (format) | 30 columns, workbook dropdown values, sorted by `lead_id`, completeness mirrors the workbook formula (test: "export values match the workbook's dropdowns and formulas") |
| README | MET | `README.md` |
| Repository access | YOU | Repo is `github.com/Akshai-max/creater-connect`. It must be private and shared with IncuBrix. |
| Both video links | **BLOCKED / YOU** | Record (a) a product walkthrough (≤5 min) and (b) a technical demo (≤8 min) with a normal run, a refresh on new input and recovery from a failure. The commands are below. |

## C. Exceptional requirements (optional)

| Requirement | Status | Evidence |
|---|---|---|
| ≥5,000 creators, ≥90% audit, ≥95% channel accuracy | NOT MET | Depends on real data |
| ≥250 Priority A with full sequences | Engine-ready | Set `PRIORITY_A_COUNT=250` |
| Refresh 5,000 rows with 0% duplicates, runtime and cost documented | **Synthetic benchmark only** | `npm run bench -- --rows 5000`: 5,050 rows in 3.9 s, a 5,250-row refresh in 6.1 s, 0 export duplicates, $0 (dry run, no DB writes). This is not lead data. |
| Channel-mix recommendation backed by response evidence | NOT MET | Needs real replies. The engine records `response_evidence_url` per route but assumes nothing. |

## D. Recorded blockers

Per the brief: "if a product feature or source is unavailable, record it with the date, time and evidence."

| Date | Blocker | Evidence |
|---|---|---|
| 2026-10-27 | No permitted source supplies monetization, need and contact evidence for 1,000 creators. Platforms' terms forbid scraping, and the YouTube Data API provides activity only. | `lib/leads/providers.ts`; README › Providers |
| 2026-10-27 | Sender identity (`SENDER_*`) isn't configured, so no message can be generated and nothing can qualify | `.env.example` › LEAD ENGINE |
| 2026-10-27 | Seed test not run: no owned test accounts are configured | `SEED_TEST_ALLOWLIST` is empty |
| 2026-10-27 | IncuBrix product not yet used by the engine author, so there are no observations | Workbook tab 01_INSIGHT |

## Fastest path to MET

1. Put `SENDER_NAME`, `SENDER_ROLE`, `SENDER_COMPANY` and `SENDER_POSTAL_ADDRESS` in `.env.local`.
2. Research creators by hand or license them, into the README's CSV input format. Every evidence URL must open. For 1,000 leads at about 3–5 minutes each, that's roughly 50–80 hours of research. Optionally add `YOUTUBE_API_KEY` with `--youtube-ids` to refresh activity automatically.
3. Run `npm run engine -- --input data/leads-input.csv`. The official `exports/leads.csv` and `outreach/` are your main output.
4. Run the seed test on your own email, LinkedIn and Instagram, then `npm run seed-test -- report --test <id> --json exports/seed-report.json`.
5. Run `npm run engine -- --runs-json exports/runs.json`, then `npm run workbook -- …` (README › Submission workbook).
6. Fill tabs 00 and 01, the self-score and the declaration, and record both videos.

## Reproducible verification commands

```bash
npm test                     # 33/33 pass
npm run typecheck            # clean
npm run build                # succeeds
npm run bench -- --rows 5000 # synthetic scale run
npm run engine -- --input tests/fixtures/leads-input.csv --dry-run --now 2026-10-27T12:00:00Z --out exports/fixture-run
```
