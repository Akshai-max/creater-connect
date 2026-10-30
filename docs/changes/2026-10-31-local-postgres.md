# Database moved to a local Postgres in Docker

**Date:** 2026-10-31
**Files:**
- `lib/db/index.ts`
- `lib/leads/repo.ts` (paged `loadAllLeads`)
- `docker-compose.yml`
- `scripts/db-backup.ts` (new)
- `package.json` (`pg`, `@types/pg`, `db:backup`)
- `.env.local` (not in git)

## Why
- **Neon's response limit broke the engine.** The app reached Neon over HTTP, and Neon refuses any response over 64 MB. At about 5,300 leads, the engine's "load every lead for the export" query passed that: "response is too large (max is 67108864 bytes)", HTTP 507. The catch-up and the 23:05 cycle ended as failed. Leads were saved and ranked, but the export didn't update and the refresh cursor didn't advance.
- **You asked for a local database.** A database on this machine has no such limit and no network round trip, and it doesn't depend on Neon's free-tier storage or compute hours.

## What changed
- **Paged loading (first fix, kept).** `loadAllLeads` reads the table 500 rows at a time instead of in one response. Confirmed on Neon: the next cycle finished as succeeded.
- **Local Postgres 18.6 in Docker.**
  - Service `postgres` in `docker-compose.yml`, container `creator-crm-postgres`.
  - Port `127.0.0.1:5433`, localhost only. Your Windows PostgreSQL 18 service already uses 5432.
  - Data lives in the `postgres` volume, and the container restarts with Docker.
  - Its password was generated into `.env.local` as `LOCAL_PG_PASSWORD` and never printed.
  - Start it with `docker compose --env-file .env.local up -d postgres`.
- **Two drivers.** `lib/db/index.ts` picks the driver from `DATABASE_URL`:
  - a localhost URL uses the standard `pg` driver (one pool per process, exits cleanly when scripts finish);
  - anything else stays on Neon over HTTP.
  - `db.batch` (a Neon feature) is provided locally as one transaction that runs the statements in order, so no calling code changed.
- **The data copy.**
  - Cycles were paused, all of Neon was dumped with `pg_dump` 18.6 (24.6 MB, `data/backups/neon-20261030-2359.dump`) and restored into the local database.
  - Every one of the 16 tables has the same row count on both sides: 5,853 leads, 241,362 evidence rows, 2,375 LLM calls and 423 outreach messages.
- **`.env.local`.**
  - `DATABASE_URL` now points to the local database.
  - The Neon string is kept as `NEON_DATABASE_URL`, and Neon itself is untouched, as a backup and rollback.
  - The previous `.env.local` is saved as `data/backups/env.local.before-local-db`.
- **`npm run db:backup`.** Dumps the local database to `data/backups/local-<UTC time>Z.dump` and keeps the newest 14. The restore command is in the script's header.

## Things to know
- **Docker Desktop has to be running** for the app and the engine cycle. It starts the database container itself.
- **The data is only on this laptop.** Run `npm run db:backup` now and then. A hosted deployment can't reach this database. To go back to Neon, set `DATABASE_URL` to the `NEON_DATABASE_URL` value. Neon has data up to 23:59 on 30 Oct only.
- **Restart the dev server** (`npm run dev`) if it was running during the switch, so it connects to the new database.

## Checks
- `npx tsc --noEmit` is clean; `npm test`: 109/109 pass.
- Through the app code, the local database answered with 5,853 leads, and loading all of them took 4.3 s (11.7 s in pages from Neon).
- The first `npm run db:backup` wrote 24.6 MB.
- The scheduled task was paused during the copy and turned back on afterwards.
