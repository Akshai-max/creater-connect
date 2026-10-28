# Remove demo data (`npm run purge-demo`)

**Date:** 2026-10-29
**Files:** `scripts/purge-demo.ts`, `package.json`

## Why
The database held only demo and dev-test data, which made the dashboard, pipeline and exports look populated when no real lead existed:

| Data | What it was |
|---|---|
| 4 creators | "Sample Expert / Demo Creator / Sample Reviewer / Maybe Creator (sample)", `@example.com` emails |
| 4 candidates | `cand_demo_1` to `cand_demo_4` |
| 10 leads, 108 evidence rows, 36 messages | all `is_fixture = true` (the test fixtures) |
| 2 outreach, 17 tasks, 55 activities | belonging to the sample creators |
| 7 engine runs | all on the fixture file `leads-input.csv` |
| 5 agent runs | failed dev test runs |

## What changed
A repeatable script that finds demo rows by rule, not by wiping tables:

- creators named `… (sample)` or with an `@example.com` / `@example.org` email
- candidates with id `cand_demo_*` or named `… (sample)`
- leads with `is_fixture = true` (their evidence and messages cascade)
- outreach, tasks, activities and tags of those creators
- engine and agent run history only with `--run-history` (on a real install that is the audit trail)

```bash
npm run purge-demo                              # dry run: lists what would go
npm run purge-demo -- --yes                     # backs up, then deletes
npm run purge-demo -- --yes --run-history       # also clears run logs
```

Before deleting, it writes everything it removes to `data/backups/demo-<timestamp>.json` (git-ignored).

## Result
Run on 2026-10-29 with `--yes --run-history`. The dry run listed exactly the rows above and nothing else. A second dry run afterwards found 0 demo rows. Backup: `data/backups/demo-2026-10-28T20-38-50-391Z.json`.

## Notes
- Tests still use fixtures. They never touch the database.
- `npm run db:seed` loads a CSV of creators. Don't run it with the sample CSV on a production database.
