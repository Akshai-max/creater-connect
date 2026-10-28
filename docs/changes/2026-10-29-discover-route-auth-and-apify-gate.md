# `/api/discover`: closed in production, Apify scraping off by default

**Date:** 2026-10-29
**Files:** `app/api/discover/route.ts`, `.env.example`

## Why
- **Open endpoint.** `/api/discover` allowed any caller when `CRON_SECRET` was empty, including in production. Anyone who found the URL could start paid Apify runs.
- **Against the brief and Instagram's terms.** The route scrapes Instagram hashtags through Apify. The brief says "Do not scrape against a site's terms", and Instagram's terms don't allow automated collection. The daily Vercel cron (`vercel.json`) would have run it every day.

## What changed
- Auth now uses the same `checkBearer` rule as the other webhooks: `Authorization: Bearer ${CRON_SECRET}`, open only outside production when no secret is set. Vercel Cron sends the header automatically once `CRON_SECRET` is set.
- The scraping only runs when `APIFY_DISCOVERY=enabled`. Otherwise the route returns `{ "skipped": true, "reason": … }`, so the cron is harmless.
- Lead discovery for the assessment uses the official APIs instead: YouTube Data API v3 and the Instagram Graph API (`npm run discover-youtube`).

## What you'll notice
The dashboard's "New candidates from Apify" card stops filling up on its own. Nothing in the UI called this route; only the cron did.

## Turning it back on
Set `APIFY_DISCOVERY=enabled` and `CRON_SECRET`. Check Instagram's terms first; `npm run check-env` warns while it's enabled.
