# Assessment self-check (2026-10-27)

**Status values:**
- **Done:** implemented and tested; the evidence is linked.
- **Partial:** works, with gaps listed in the Evidence / notes column.
- **Blocked:** needs something that isn't available in this environment.

| Requirement | Status | Evidence / notes |
|---|---|---|
| A. 1,000 qualified creators | **Blocked** | The actual qualified real-creator count is **0**. The engine works, but no permitted data source with monetization, need and contact evidence has been supplied. The only qualified rows so far are fictional fixtures, which are excluded from the official export. |
| A. Geographic rules (≥80% approved, ≥3 countries, ≤60% max) | Done (logic) | `lib/leads/distribution.ts`, `tests/dedupe-export.test.ts` › country distribution, and the **/leads** validation card |
| B. Deterministic qualification, all 10 criteria | Done | `lib/leads/qualify.ts`, `tests/qualify.test.ts` |
| B. AI score kept separate from qualification | Done | The qualifier takes no AI input. Test: "AI fit score fields in input do not affect qualification". |
| C. 30-column leads.csv, UTF-8, escaping, deterministic | Done | `lib/leads/export.ts`, `tests/dedupe-export.test.ts`, `GET /api/export/leads` |
| C. Workbook reconciliation | Partial | `validation-report.json` reconciles with the CSV (tested). The workbook itself isn't in the repo. |
| D. Priority A: top 25, explainable | Done | `lib/leads/scoring.ts`, the score breakdown on **/leads/[id]**, Priority A tests |
| E. 3 channels × 3 messages, sender, opt-out, limits | Done | `lib/leads/messages.ts`, `tests/outreach.test.ts`, `exports/outreach/*.md` |
| E. Review UI: edit, approve, copy, export | Done | **/leads/[id]**. Approval is blocked until `SENDER_*` is set; this was confirmed in the browser. |
| F. Best and backup channel with reasons and evidence | Done | `lib/leads/channels.ts`, test "channel recommendation explains itself" |
| G. Pipeline with run metrics, idempotent, one command | Done | `npm run engine`. Verified against Neon: first run 10 inserted; rerun 0/0/10; refresh 1 new, 1 updated; simulated failure recorded; recovery rerun succeeded. |
| G. Webhook validation and authentication | Done | `lib/auth.ts`, `/api/engine/ingest`, hardened Apify webhook, auth tests |
| G. Provider/API cost recorded | Partial | YouTube quota units are counted. USD cost is 0 because the free tiers are used. AI is not used in the engine. |
| H. Test mode and allowlist | Done | `lib/leads/seed-test.ts`, guard in `app/outreach/actions.ts`, tests |
| H. Seed test **passed** | **Not run** | Needs your own accounts in `SEED_TEST_ALLOWLIST` and `RESEND_API_KEY`. The tracking, event and report code is tested, but no real seed test has been executed. |
| I. Dashboard items 1–10 | Done | Candidate queue status and reasons, creator evidence card, **/leads**, **/leads/[id]**, **/engine** |
| Workbook tabs 00–04 | **Blocked** | The workbook wasn't provided |
| Launch kit | Draft | `docs/LAUNCH_PLAN.md`. All rates in it are labelled as estimates. |
| Two demo videos | **Not done** | They need a person to record them. The commands to show are in the README › Lead engine section. |
| Lint | Not available | The repo has no ESLint configuration. `npm run typecheck` and `npm run build` pass. |

## Reproducible commands used for verification

```bash
npm test                                   # 32/32 pass
npm run typecheck                          # clean
npm run build                              # succeeds
npm run db:push                            # adds 6 tables
npm run engine -- --input tests/fixtures/leads-input.csv --fixture --now 2026-10-27T12:00:00Z --out exports/fixture-run
```
