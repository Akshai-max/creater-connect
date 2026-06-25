# Creator CRM

An open, self-hostable **creator / influencer CRM** for running an outreach program end to end — discover creators, score them for fit, manage a pipeline, draft and send outreach, and track every interaction. Built on **Next.js 16 + Postgres + Drizzle ORM** and deploys to Vercel in a few minutes.

It works out of the box with zero API keys (heuristic scoring + template emails) and gets smarter as you add optional integrations (Claude for AI scoring/drafting, Resend for email, Apify for auto-discovery).

> **This is a template.** All sample data is fictional. Point it at your own brand via a few environment variables (see [Configuration](#configuration)).

## Features

- **Pipeline Kanban** — a 10-stage flow (Lead → Outreached → Replied → Negotiating → Briefed → Content In → Live → Paid → Past Hire → Cold)
- **Roster** — searchable, filterable creator database
- **Candidate queue** — auto-discovered creators land here for one-click ✅/❌ review
- **AI fit scoring** — each candidate scored 0–10 against *your* brand context (Claude Haiku 4.5), with a heuristic fallback when no API key is set
- **AI outreach drafts** — personalized pitches grounded in the creator's own content, sent via Resend (or saved as drafts)
- **Activity timeline** — every stage change, note, tag, and task auto-logs per creator
- **Tasks & auto-tasks** — stage transitions create follow-up tasks with due dates
- **Tags** — free-form labels with roster filtering

## Tech stack

- **Next.js 16** (App Router, Server Components, Server Actions)
- **Postgres** (any provider; [Neon](https://neon.tech) free tier recommended)
- **Drizzle ORM** (`drizzle-orm/neon-http`)
- **Tailwind CSS 4** + shadcn-style primitives
- **Anthropic SDK** (optional) — Claude Haiku 4.5
- **Resend** (optional) — email delivery
- **Apify** (optional) — creator discovery

---

## Quick start (local)

```bash
git clone https://github.com/<your-username>/creator-crm.git
cd creator-crm
npm install
cp .env.example .env.local      # fill in APP_PASSWORD + DATABASE_URL (see below)
npm run db:push                 # create tables
npm run db:seed                 # load a few fictional sample candidates
npm run dev                     # http://localhost:3000
```

Sign in with the `APP_PASSWORD` you set.

---

## Configuration

All configuration is via environment variables. Copy `.env.example` → `.env.local` and fill in what you need.

### Required

| Variable | What it's for | Where to get it |
|---|---|---|
| `APP_PASSWORD` | Shared password to sign in. Anyone with it gets in — use a long random string. | You choose it |
| `DATABASE_URL` | Postgres connection string. | [Neon](https://neon.tech) (free) or any Postgres. On Vercel, provision Neon from the **Storage** tab and it's injected automatically. |

### Brand config (recommended)

These make the AI features actually about *your* brand:

| Variable | What it's for |
|---|---|
| `BRAND_NAME` | Display name shown in the UI and used in outreach (default: `Acme`). |
| `TARGET_NICHE` | The kind of creators you want — drives the fit scorer (e.g. `home fitness`, `skincare`). |
| `BRAND_CONTEXT` | A short paragraph about your brand, products, positioning, and what makes a creator a good fit. Injected verbatim into the AI prompts — be specific. |

### Optional integrations (degrade gracefully)

| Variable | Unlocks | If unset |
|---|---|---|
| `ANTHROPIC_API_KEY` | AI candidate scoring + outreach drafting ([console.anthropic.com](https://console.anthropic.com), ~$0.001/call) | Falls back to heuristic scoring + template emails |
| `RESEND_API_KEY` + `OUTREACH_FROM_EMAIL` | Sending real emails ([resend.com](https://resend.com)) | Pitches save as drafts |
| `APIFY_TOKEN` + `APIFY_WEBHOOK_SECRET` | Automated daily creator discovery ([console.apify.com](https://console.apify.com)) | Skip auto-discovery; add candidates manually or via the API |
| `CRON_SECRET` | Protects `/api/discover` in production (Vercel Cron bypasses it) | Endpoint is unprotected — set this in production |

> **Security:** `.env.local` is git-ignored. **Never commit real keys, connection strings, or creator PII.** See [Security notes](#security-notes).

---

## Deploy to Vercel

1. **Push your fork/clone to GitHub.**
2. **Import the repo** at [vercel.com/new](https://vercel.com/new). Framework (Next.js) is auto-detected.
3. **Provision a database**: project → **Storage** → **Create Database** → **Neon** (free). This injects `DATABASE_URL` automatically.
4. **Add env vars**: project → **Settings → Environment Variables**. Set `APP_PASSWORD` and the brand config; add optional keys as needed.
5. **Create the schema**: locally, with `.env.local` pointing at the same database, run `npm run db:push` (and `npm run db:seed` if you want sample data). Or use the Neon SQL editor.
6. **Redeploy** so the new env vars take effect.

---

## Importing your own creators

`npm run db:seed` loads a few fictional sample candidates. To bulk-import a real roster, drop a CSV at the project root named `seed-creators.csv` (or set `CSV_PATH`) and re-run the seed. Expected columns include `creator_id` (e.g. `CR001`), `Name`, `Handle`, `Platform`, `Follower count`, `Email`, `Location`, `Niche`, `Audience`, `Rate ceiling ($)`, `Lifecycle status`, `Flag notes`, etc. See `scripts/seed-from-csv.ts` for the full mapping.

> Keep `seed-creators.csv` out of git — it's covered by `*.csv` in `.gitignore`. Real contact data should never be committed.

## Automated discovery (optional)

With `APIFY_TOKEN` set, `/api/discover` runs your Apify scrapers, scores results, filters junk, and drops new candidates into the review queue. You can also POST directly to the webhook:

```
POST /api/apify/webhook
Authorization: Bearer ${APIFY_WEBHOOK_SECRET}
Content-Type: application/json

{
  "source": "apify-hashtag",
  "sourceDetail": "#ugccreator",
  "candidates": [
    { "handle": "@example", "fullName": "...", "followers": 12000, "engagementRate": 4.5,
      "email": "...", "location": "Austin, TX", "bio": "...", "externalUrl": "...",
      "isUS": true, "nicheRelevant": true, "rateBand": "$100-$300", "fitScore": 7.8, "fitReasoning": "..." }
  ]
}
```

Edit the example hashtag rotation in `lib/apify-client.ts` to target your niche, and the junk-filter signals in `lib/candidate-quality.ts`.

## Database schema

A single Postgres database with 7 tables: `creators`, `candidates`, `outreach`, `activities`, `tasks`, `tags`, `campaigns`. See `lib/db/schema.ts`.

---

## Security notes

This app gates access behind a single shared `APP_PASSWORD` and stores creator contact data. Before running it for real:

- **Set a strong, unique `APP_PASSWORD`** and a `CRON_SECRET` in production.
- **Never commit secrets or real creator data.** `.env*.local`, `*.db`, and `*.csv` are git-ignored — keep it that way.
- The shared-password gate is intentionally simple. For multi-user or higher-stakes deployments, swap in real auth (e.g. [Clerk](https://clerk.com), Auth0) and per-user roles.
- You are responsible for how you contact creators — follow applicable marketing/email regulations (CAN-SPAM, GDPR, FTC disclosure rules) in your jurisdiction.

## License

[MIT](./LICENSE) — free to use, modify, and self-host.
