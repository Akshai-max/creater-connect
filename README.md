# Creator CRM

An open, self-hostable **creator / influencer CRM** for running an outreach program end to end: discover creators, score them for fit, manage a pipeline, draft and send outreach, and track every interaction. Built on **Next.js 16 + Postgres (Neon) + Drizzle ORM**, and deploys to Vercel in a few minutes.

It works out of the box with zero API keys (heuristic scoring + template emails) and gets smarter as you add optional integrations (Claude for AI scoring/drafting, Resend for email, Apify for auto-discovery).

> **This is a template.** All sample data is fictional. Point it at your own brand via a few environment variables (see [Configuration](#configuration)).

## Contents

- [How it works](#how-it-works)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Quick start (local)](#quick-start-local)
- [Configuration](#configuration)
- [npm scripts](#npm-scripts)
- [Project structure](#project-structure)
- [Deploy to Vercel](#deploy-to-vercel)
- [Importing your own creators](#importing-your-own-creators)
- [Automated discovery (optional)](#automated-discovery-optional)
- [Lead engine](#lead-engine)
- [Database schema](#database-schema)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)
- [License](#license)

---

## How it works

```
 Discover            Review              Manage                     Close
┌──────────┐      ┌────────────┐      ┌──────────────────┐      ┌──────────┐
│ Apify    │      │ Candidate  │  ✅  │ Roster + Pipeline│      │ Live →   │
│ scrape / │ ───► │ queue      │ ───► │ (10 stages)      │ ───► │ Paid →   │
│ webhook /│      │ fit score  │      │ outreach, notes, │      │ Past Hire│
│ CSV seed │      │ 0–10       │  ❌  │ tasks, tags      │      │          │
└──────────┘      └────────────┘      └──────────────────┘      └──────────┘
```

1. **Discover**: creators come in from the daily Apify scrape (`/api/discover`), the webhook (`/api/apify/webhook`), or a CSV import.
2. **Score & filter**: each candidate gets a 0–10 fit score against your `BRAND_CONTEXT` (Claude, or a heuristic without an API key), and obvious junk (brand accounts, off-niche, etc.) is filtered out.
3. **Review**: you approve ✅ or reject ❌ candidates in the queue. Approved ones become **creators** in the roster at the `Lead` stage.
4. **Work the pipeline**: draft personalized outreach, move creators through stages, log notes and tags. Stage changes auto-create follow-up tasks and log to the activity timeline.
5. **Today view**: the dashboard (`/`) shows tasks due today and recent activity.

## Features

- **Pipeline Kanban**: a 10-stage flow (Lead → Outreached → Replied → Negotiating → Briefed → Content In → Live → Paid → Past Hire → Cold)
- **Roster**: searchable, filterable creator database
- **Candidate queue**: auto-discovered creators land here for one-click ✅/❌ review
- **AI fit scoring**: each candidate scored 0–10 against *your* brand context (Claude Haiku 4.5), with a heuristic fallback when no API key is set
- **AI outreach drafts**: personalized pitches grounded in the creator's own content, sent via Resend (or saved as drafts)
- **Activity timeline**: every stage change, note, tag, and task auto-logs per creator
- **Tasks & auto-tasks**: stage transitions create follow-up tasks with due dates
- **Tags**: free-form labels with roster filtering
- **Campaigns**: group creators under a campaign

## Tech stack

- **Next.js 16** (App Router, Server Components, Server Actions, Turbopack)
- **React 19**
- **Postgres on [Neon](https://neon.tech)** (free tier is plenty)
- **Drizzle ORM** (`drizzle-orm/neon-http`) + `drizzle-kit` for schema push
- **Tailwind CSS 4** + shadcn-style primitives (Radix UI, lucide icons)
- **Anthropic SDK** (optional): Claude Haiku 4.5
- **Resend** (optional): email delivery
- **Apify** (optional): creator discovery

---

## Quick start (local)

**Prerequisites:** Node.js 20+ and a free [Neon](https://neon.tech) Postgres database.

```bash
git clone https://github.com/<your-username>/creator-crm.git
cd creator-crm
npm install
cp .env.example .env.local      # fill in APP_PASSWORD + DATABASE_URL (see below)
npm run db:push                 # create tables
npm run db:seed                 # load a few fictional sample candidates
npm run dev                     # http://localhost:3000
```

Open http://localhost:3000 and sign in with the `APP_PASSWORD` you set.

> **Windows:** these commands work in PowerShell and Git Bash. In `cmd.exe`, use `copy .env.example .env.local` instead of `cp`.

---

## Configuration

All configuration is via environment variables. Copy `.env.example` → `.env.local` and fill in what you need.

### Required

| Variable | What it's for | Where to get it |
|---|---|---|
| `APP_PASSWORD` | Shared password to sign in. Anyone with it gets in, so use a long random string. If unset, the app is **open to anyone**. | You choose it |
| `DATABASE_URL` | Neon Postgres connection string (`postgres://…?sslmode=require`). | [Neon](https://neon.tech) → project → **Connection string**. On Vercel, provision Neon from the **Storage** tab and it's injected automatically. |

> The app uses Neon's serverless HTTP driver, so `DATABASE_URL` must point at a **Neon** database. A plain local Postgres won't work without a Neon HTTP proxy. See [Troubleshooting](#troubleshooting).

### Brand config (recommended)

These make the AI features actually about *your* brand:

| Variable | What it's for |
|---|---|
| `BRAND_NAME` | Display name shown in the UI and used in outreach (default: `Acme`). |
| `TARGET_NICHE` | The kind of creators you want. Drives the fit scorer (e.g. `home fitness`, `skincare`). |
| `BRAND_CONTEXT` | A short paragraph about your brand, products, positioning, and what makes a creator a good fit. Injected verbatim into the AI prompts, so be specific. |

### Optional integrations (degrade gracefully)

| Variable | Unlocks | If unset |
|---|---|---|
| `ANTHROPIC_API_KEY` | AI candidate scoring + outreach drafting ([console.anthropic.com](https://console.anthropic.com), ~$0.001/call) | Falls back to heuristic scoring + template emails |
| `RESEND_API_KEY` + `OUTREACH_FROM_EMAIL` | Sending real emails ([resend.com](https://resend.com)) | Pitches save as drafts |
| `APIFY_TOKEN` + `APIFY_WEBHOOK_SECRET` | Automated daily creator discovery ([console.apify.com](https://console.apify.com)) | Skip auto-discovery; add candidates manually or via the API |
| `CRON_SECRET` | Protects `/api/discover` in production (Vercel Cron bypasses it) | Endpoint is unprotected, so set this in production |

> **Security:** `.env.local` is git-ignored. **Never commit real keys, connection strings, or creator PII.** See [Security notes](#security-notes).

---

## npm scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server at http://localhost:3000 |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run db:push` | Create/update tables in your database from `lib/db/schema.ts` |
| `npm run db:studio` | Open Drizzle Studio to browse and edit data |
| `npm run db:seed` | Load sample candidates (and `seed-creators.csv` if present). Safe to re-run. Don't run it on a production database |
| `npm run discover` | Trigger the Apify discovery route on the local dev server (needs `curl` + `jq`). Off unless `APIFY_DISCOVERY=enabled` |
| `npm run purge-demo [-- --yes]` | Remove sample creators, demo candidates and fixture leads, with a backup in `data/backups/` (dry run without `--yes`) |
| `npm run check-env` | Check `.env.local` as if it were production: lists missing or risky settings by name, never values |
| `npm run classify-entities -- --in <csv>` | Entity check (Groq → Gemini → Ollama): sets `entity_type` only from an exact, located quote in the creator's own text (see [Entity check](#entity-check)) |
| `npm run llm-check` | Test each configured LLM provider with one tiny call: shows a bad key, wrong model, rate limit or used-up quota |
| `/agent` page or `POST /api/agent/run` | Run the AI agent: proposes picks, drafts and next steps for review (see [AI agent](#ai-agent)) |
| `npm run engine -- --input <file>` | Run the lead engine end to end (see [Lead engine](#lead-engine)) |
| `npm run seed-test -- start` | Start a seed test against your own allowlisted accounts |
| `npm run discover-youtube -- --ids <file>` | Discover YouTube creators into a research CSV (public RSS, or the official API with `YOUTUBE_API_KEY`), with their published Instagram/LinkedIn links |
| `npm run bench -- --rows 5000` | Time a normal run and a refresh on synthetic rows (no database) |
| `npm run workbook -- --template <xlsx> --leads <leads.csv> --out <xlsx>` | Fill the submission workbook from real engine output (needs Python 3 + `openpyxl`) |
| `npm test` | Run the automated test suite (no database needed) |
| `npm run typecheck` | TypeScript check |

`scripts/` also contains one-off maintenance scripts (rescoring, enrichment, stats, cleanup). Run any of them with:

```bash
node --env-file=.env.local --import tsx scripts/<name>.ts
```

---

## Project structure

```
app/
  page.tsx                 Dashboard: today's tasks + recent activity
  login/                   Password sign-in
  candidates/              Discovery review queue (approve / reject / cleanup)
  creators/                Roster, creator detail (notes, tags, tasks, timeline)
  pipeline/                10-stage Kanban + stage mover
  outreach/                Outreach list + AI composer
  campaigns/               Campaigns
  api/
    discover/              Daily discovery job (Vercel Cron)
    apify/webhook/         Inbound candidates from Apify / any scraper
    avatar/[kind]/[id]/    Avatar image proxy
components/                Sidebar, avatar, shadcn-style UI primitives
lib/
  db/                      Drizzle client + schema
  ai-scoring.ts            Claude / heuristic fit scoring
  outreach-prompt.ts       Outreach drafting prompt
  candidate-quality.ts     Junk-filter signals
  apify-client.ts          Apify scrapers + hashtag rotation
  stages.ts                Pipeline stage definitions
  stage-automations.ts     Auto-tasks on stage change
  activity.ts              Activity timeline logging
  brand.ts                 Brand config from env vars
app/leads/                 Lead list, validation, evidence, 3-channel sequence editor
app/engine/                Run history + seed-test results
lib/leads/                 Lead engine: qualify, score, channels, messages, export, providers, repo, engine
lib/auth.ts                Constant-time bearer check for webhooks
tests/                     node:test suite + fictional fixtures
proxy.ts                   Password gate (Next.js 16 "proxy", formerly middleware)
scripts/                   Seed + maintenance scripts
vercel.json                Daily cron for /api/discover (13:00 UTC)
```

---

## Deploy to Vercel

1. **Push your fork/clone to GitHub.**
2. **Import the repo** at [vercel.com/new](https://vercel.com/new). Framework (Next.js) is auto-detected.
3. **Provision a database**: project → **Storage** → **Create Database** → **Neon** (free). This injects `DATABASE_URL` automatically.
4. **Add env vars**: project → **Settings → Environment Variables**. Set `APP_PASSWORD`, `CRON_SECRET`, and the brand config; add optional keys as needed.
5. **Create the schema**: locally, with `.env.local` pointing at the same database, run `npm run db:push` (and `npm run db:seed` if you want sample data). Or use the Neon SQL editor.
6. **Redeploy** so the new env vars take effect.

`vercel.json` schedules `/api/discover` daily at 13:00 UTC with a 300s function timeout.

---

## Importing your own creators

`npm run db:seed` loads a few fictional sample candidates. To bulk-import a real roster, drop a CSV at the project root named `seed-creators.csv` (or set `CSV_PATH`) and re-run the seed. Expected columns include `creator_id` (e.g. `CR001`), `Name`, `Handle`, `Platform`, `Follower count`, `Email`, `Location`, `Niche`, `Audience`, `Rate ceiling ($)`, `Lifecycle status`, `Flag notes`, etc. See `scripts/seed-from-csv.ts` for the full mapping.

> Keep `seed-creators.csv` out of git. It's covered by `*.csv` in `.gitignore`. Real contact data should never be committed.

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

## Lead engine

An evidence-based lead qualification and outreach engine for podcasters, video-first creators, and expert-led creators. It runs alongside the CRM and reuses its database, auth, and pipeline.

```
input (CSV / JSON / candidates table / ingest API) [+ YouTube Data API refresh]
  → normalize → validate → dedupe → verify evidence → qualify → score
  → select channels → draft 3×3 sequences → export leads.csv → record run metrics
```

### Run it

```bash
npm run db:push                                        # adds the engine tables (additive)
npm run engine -- --input data/leads-input.csv         # the single command
```

| Flag | What it does |
|---|---|
| `--input <file>` | `.csv` (format below) or `.json` (array of LeadInput objects) |
| `--provider candidates` | Evaluate the existing review queue instead of a file |
| `--youtube-ids <file>` | Refresh activity, subscribers, country and language from the YouTube Data API for these channel ids (needs `YOUTUBE_API_KEY`) |
| `--dry-run` | No database. Processes the file and writes exports to `exports/dry-run/` |
| `--fixture` | Mark rows as fixtures. Fixtures never appear in the official export. |
| `--include-non-qualified` | Put every lead in `leads.csv`. `leads-all.csv` always has them all. |
| `--simulate-failure-after <n>` | Demo: fail after persisting n leads, then rerun to show recovery |
| `--now <iso>` | Evaluate time windows as of this instant (reproducible demos) |
| `--purge-fixtures` | Delete fixture leads only |

Each run writes `exports/leads.csv` (official, qualified only), `exports/leads-all.csv` (audit), `exports/validation-report.json`, `exports/outreach/<lead_id>.md` (every Priority A sequence) and `exports/outreach/_SEQUENCES_BY_SEGMENT.md` (templates for each segment on all 3 channels).

`leads.csv` uses the submission workbook's vocabulary so the workbook's formulas recalculate the same result: rows sorted by `lead_id`; `creator_segment` is `Podcaster/Video Podcaster`, `YouTuber/Video-First Creator` or `Expert-Led Creator`; channels are `Email`/`LinkedIn`/`Instagram`; `candidate_status` is `Qualified` or `Rejected` (an internally *unverified* lead exports as `Rejected` with `UNVERIFIED (evidence missing): …`); `priority` is `A`/`B`/`C` for qualified rows only; `duplicate_check` is `UNIQUE`/`DUPLICATE`; and `completeness_check` mirrors the workbook formula (`COMPLETE`, `MISSING FIELDS` or `REJECTED`). It also records a row in `engine_runs`: start and finish time, duration, inserted, updated, unchanged, qualified, unverified, rejected, duplicate and failed counts, API units, cost, and redacted errors. You can see these on **/engine**. The process exits non-zero when a run fails.

Reruns are idempotent. `lead_id` is a hash of `platform:stable_creator_id`, leads upsert on that identity, and the evidence for each lead is replaced inside a single transaction. Messages you've edited or approved are never overwritten.

Try it with the fictional fixtures:

```bash
npm run engine -- --input tests/fixtures/leads-input.csv --dry-run --now 2026-10-27T12:00:00Z
```

### Qualification rules (`lib/leads/qualify.ts`)

Every check must pass for `qualified`. A failed **reject** check means the evidence shows the lead doesn't fit. A failed **unverified** check means evidence is missing or malformed. Nothing incomplete is ever auto-qualified, and AI fit scores are not inputs.

| Check | Rule | Fails as |
|---|---|---|
| entity | `entity_type = individual`; agency/management/brand/publication/directory/fan_account excluded | reject |
| segment | podcaster, video_podcaster, youtuber, expert_creator | reject |
| country | US, CA, GB, IE, AU, NZ, SG with an evidence URL | reject (wrong country) / unverified (no evidence) |
| language | primary language `en` | reject |
| profile | profile URL on the platform's domain + valid stable id (e.g. YouTube `UC…` channel id, not an @handle) | unverified |
| activity | ≥8 items in 30 days **or** ≥2 long-form in 60 days (inclusive, future dates ignored) | reject |
| monetization | sponsorship/product/service/course/membership/subscription/affiliate/other + evidence URL | unverified |
| need | content_creation/repurposing/editing/captions/publishing_consistency/content_backlog/team_workflow + evidence URL | unverified |
| no_guessing | every contact route `source = published` | reject |
| contact | ≥1 published, business-use route with evidence, active within 60 days | unverified |
| personalization | a titled content item from the last 60 days | unverified |
| message | first message passes sender-ID, opt-out, content-reference and length checks | unverified |
| complete / fresh | required fields present; `checked_date` within 30 days | unverified |
| unique | no other lead shares the identity, canonical profile URL or a published contact | reject |

Dataset rules (shown on **/leads** and in `validation-report.json`): at least 80% of leads from approved countries, at least 3 approved countries, and no single country over 60%.

### Scoring and Priority A (`lib/leads/scoring.ts`)

The score runs from 0 to 100, and every factor stores its points and the reason for them:

| Factor | Max points |
|---|---|
| Fit (segment × audience band) | 20 |
| Evidence quality | 15 |
| Activity | 15 |
| Commercial signals | 15 |
| Need | 15 |
| Reachability | 10 |
| Personalization potential | 10 |

Missing data earns 0 for its factor. Priority A is the top `PRIORITY_A_COUNT` (default 25) **qualified** leads, ranked across the whole dataset with ties broken by `lead_id`. Other qualified leads are B (score ≥ 60) or C. Leads that aren't qualified get N/A in the database and an empty `priority` in the export.

### Channels and messages

`lib/leads/channels.ts` ranks only published, evidenced, business-use routes that are active within 60 days. It returns the best and backup channels, the reason for each, the evidence used, and a verification status. It never assumes a creator responds on a channel unless there's response evidence.

`lib/leads/messages.ts` drafts one initial message and two follow-ups per channel (email, LinkedIn, Instagram) using deterministic templates. They're built only from stored evidence: they cite a real content item, name the sender (`SENDER_*`), and include opt-out language. Each channel has a length limit: a 300-character LinkedIn connection note, Instagram under 700 characters, email under 1,200. A channel with no verified route gets status `unavailable` with the reason, and no contact details are made up. Edit and approve drafts on **/leads/[id]**. Approving re-runs the checks. **Nothing is sent automatically.**

### CSV input format

One row per creator, UTF-8, with a header row. Unknown columns are ignored. Leave a cell blank if you have no evidence for it; don't guess.

| Column | Example / notes |
|---|---|
| `creator_name`, `creator_segment`, `entity_type` | `Jane Doe`, `video_podcaster`, `individual` |
| `country_iso2`, `country_evidence_url` | `GB`, the about page that states the location |
| `primary_language` | `en` |
| `primary_platform`, `profile_url`, `stable_creator_id` | `youtube`, `https://www.youtube.com/channel/UC…`, `UC…` (22 chars after UC) |
| `followers_or_subscribers` | `42000` |
| `content_items` | JSON array: `[{"url":"…","title":"…","publishedAt":"2026-10-20","isLongform":true}]` |
| `monetization_signal`, `monetization_evidence_url` | `sponsorship`, URL of a sponsor read or offer page |
| `incubrix_need`, `need_signal_text`, `need_evidence_url` | `repurposing`, short paraphrase of the evidence, URL |
| `email`, `email_evidence_url`, `email_last_active`, `email_source`, `email_business_use` | `published` / `yes` |
| `linkedin_url`, `linkedin_…` | same suffixes as email |
| `instagram_handle`, `instagram_…` | same suffixes as email |
| `checked_date` | date the evidence was last checked by hand or by a provider |
| `source`, `source_ref` | where the row came from |

Structural errors, such as a missing stable id, an unknown platform or bad JSON, are recorded as `failed` with the line number. Evidence gaps are not errors: they show up in the lead's status.

### Providers

| Provider | Supplies | Notes |
|---|---|---|
| CSV / JSON file | Everything | Research exports, licensed data, manual verification |
| YouTube Data API v3 (`--youtube-ids`) | Subscribers, uploads (dates, titles, long-form ≥ 20 min), self-declared country, audio language | Official API, free quota (about 3 units per channel), counted in `api_units`. Monetization, need and contact evidence still come from the file. |
| Candidates table (`--provider candidates`) | Existing review-queue rows | Mostly lack evidence, so they come out `unverified` and the queue shows why |
| `POST /api/engine/ingest` | Rows from any external tool | Bearer `ENGINE_WEBHOOK_SECRET`, up to 2,000 rows per call |
| Apify webhook (existing) | IG hashtag discovery | Now constant-time authenticated and payload-validated |

When no provider is configured, the engine fails with a clear error. It never substitutes placeholder data.

### Discovery (`npm run discover-youtube`)

Discovery finds candidate creators and writes a **research CSV** in the input format above, which `npm run engine -- --input` reads directly.

```bash
# No key: YouTube's public per-channel RSS feed (last 15 uploads, exact dates, descriptions)
npm run discover-youtube -- --ids data/channel-ids.txt --out data/discovered.csv
# Official API (YOUTUBE_API_KEY): adds durations (long-form), self-declared country, subscribers
npm run discover-youtube -- --ids data/channel-ids.txt --api --out data/discovered.csv
# Official API search by topic and region (about 100 quota units per query and region)
npm run discover-youtube -- --query "podcast;business coach;productivity" --regions US,GB,CA,AU,IE,NZ,SG --out data/discovered.csv
```

`lib/leads/discovery.ts` pre-fills a row from what the creator publishes, using plain rules (no AI). Each signal keeps the URL it was found on and a quote column for audits:

- sponsor reads, promo and affiliate codes, courses, memberships and newsletters, as monetization evidence;
- "hiring an editor" style statements, as **stated** need evidence;
- when nothing is stated, **observed** needs from the channel's own API data: no uploaded caption track on recent long-form videos (`captions`), long episodes but no Shorts (`repurposing`), or a long gap between uploads (`publishing_consistency`). They're labelled `need_source=observed` with the exact fact in `need_observation`, and messages say "I noticed…" instead of "You mentioned…";
- an email published next to "business inquiries", as a published business contact;
- upload dates, as activity;
- Instagram (`instagram.com/<handle>`) and LinkedIn (`linkedin.com/in/<slug>`) links in the channel or video descriptions, as backup channels. Posts, reels, hashtag pages and company pages are skipped or ranked below a personal profile.

**Instagram check (optional, official API).** With `INSTAGRAM_ACCESS_TOKEN` and `INSTAGRAM_IG_USER_ID` set, each published Instagram handle is looked up with the Instagram Graph API's [Business Discovery](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery) endpoint, using your own professional account.
- The date of the latest post becomes `instagram_last_active`.
- A bio that mentions business, collabs or an email sets `instagram_business_use=yes`. A business email in the bio is used when the channel has none, with the profile as evidence.
- Personal accounts return nothing and keep a `CHECK` note.
- Results are cached for 30 days in `data/instagram-cache.json`. Lookups stop at the first rate-limit response, and a rerun carries on. Use `--no-instagram` to skip them.

**LinkedIn** has no permitted API for this, and scraping is against its terms. A LinkedIn link is recorded with the video or page it was published on, but its activity and business use stay empty with a `CONFIRM` note until a person checks the profile. Until then, LinkedIn isn't chosen as a reachable channel.

#### Entity check

Every discovered row starts as `entity_type=needs_review`. `npm run classify-entities` asks a model one short question per row, with JSON-only output. The model comes from the [LLM router](#free-llms-and-automatic-failover): Groq first, then Gemini, then local Ollama (about 15 s a row on a laptop CPU). The model must answer with an **exact quote** from the creator's own text (channel name, description, video titles), and code then checks it:

1. The quote must appear word for word in that text, ignoring case, spacing and curly quotes. Otherwise it's rejected.
2. The quote must say *who runs the channel*: "I'm…", "hosted by…" or "join me" for a person, and "agency", "network" or "official channel" for an organisation. A real but irrelevant quote, such as a video title or slogan, is rejected.
3. "Unsure", or either check failing, leaves the row as `needs_review` with an `entity_note`.

A confirmed row gets `entity_evidence_url`, `entity_quote` and `entity_source=ai:<model>`, stored as an `entity` evidence item. The evidence is the creator's own words; the model only points at them. Rows a person already set are never changed, and only rows where the entity type decides the outcome are checked (the rest are rejected for other reasons). Answers are cached in `data/entity-cache.json`, so an interrupted run resumes.

```bash
npm run llm-check                                    # are the keys working?
npm run classify-entities -- --in data/discovered.csv
npm run engine -- --input data/discovered.csv
```

#### Free LLMs and automatic failover

`lib/llm/router.ts` sends each model call to the first available provider in `LLM_PROVIDERS` (default `groq,gemini,ollama`; unconfigured ones are skipped):

| Provider | Key | Default model |
|---|---|---|
| Groq | `GROQ_API_KEY` ([console.groq.com/keys](https://console.groq.com/keys)) | `openai/gpt-oss-120b` (`GROQ_MODEL`) |
| Google Gemini | `GEMINI_API_KEY` ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)) | `gemini-3.5-flash` (`GEMINI_MODEL`) |
| Ollama (local) | none | `OLLAMA_MODEL` |

When a provider fails, the router writes the reason and a rest period to `llm_calls`, then moves to the next one:

| Response | Status | Rests for |
|---|---|---|
| 429 that says per day, daily, PerDay, TPD or RPD | `quota_exhausted` | until midnight US Pacific (or the provider's `retry-after`) |
| other 429 | `rate_limited` | `retry-after`, else 60 s |
| 401 / 403 | `error` (key rejected) | 1 h, this run only |
| 400 (e.g. Groq `json_validate_failed`) | `invalid_output` | none, the next provider is tried |
| 404 | `error` (model not found) | 1 h, this run only |
| 5xx or network | `error` | 30 s |
| reply the caller can't use | `invalid_output` | none, the next provider is tried |

Rests from limits and outages carry over between runs: a used-up daily quota stays skipped until it resets. Rests from a bad key or model don't, because the fix is changing `.env.local`. A successful call clears a provider's rest.

Both default models reason before answering, so the router sends `reasoning_effort: low` (`LLM_REASONING_EFFORT` = `low`, `medium`, `high` or `off`). The free tiers allow only a few calls a minute. The router reads Groq's `x-ratelimit-*` headers and waits for tokens to refill before sending (up to 20 s), and `npm run classify-entities` waits out rests of 10 minutes or less instead of stopping.

**Audit:** the **AI usage** page (`/ai-usage`) shows each provider's state (available, resting until…, not configured), its last-24-hour calls, failures, tokens and average latency, every automatic switch ("answered by gemini after groq (quota_exhausted…)") and the latest 100 calls. `AGENT_PROVIDER=free` runs the AI agent on the same router, hosted providers only, and a run can switch provider between turns.

Rows always start with `entity_type=needs_review` and a `review_notes` column listing what a person must confirm or find. **A discovered row is never qualified without that review.** When video length is unknown (RSS has no durations), the activity check is *unverified*, not rejected.

A pilot on 16 real channels is written up in [`docs/PILOT_RESULTS.md`](docs/PILOT_RESULTS.md). It found 0 qualified, 12 unverified and 4 inactive, and the missing need evidence is the main gap. The guides for the remaining deliverables are [`docs/SEED_TEST_RUNBOOK.md`](docs/SEED_TEST_RUNBOOK.md), [`docs/VIDEO_SCRIPTS.md`](docs/VIDEO_SCRIPTS.md) and [`docs/PRODUCT_INSIGHT_TEMPLATE.md`](docs/PRODUCT_INSIGHT_TEMPLATE.md).

### Test mode and seed test

`OUTREACH_MODE=test` is the default. In test mode, every real send path refuses recipients that aren't on `SEED_TEST_ALLOWLIST`. That includes the existing Resend composer.

```bash
npm run seed-test -- start                                   # schedules + sends email via Resend; prints LinkedIn/IG messages to send by hand
npm run seed-test -- mark-sent --test <id> --channel linkedin
# click the tracking link in each message (logs a click), reply from the test account, then:
npm run seed-test -- reply --test <id> --channel email
npm run seed-test -- report --test <id> --json exports/seed-report.json   # expected vs observed; exits 2 until all pass
```

LinkedIn and Instagram have no permitted API for sending these messages, so those channels use a manual adapter: you send from your own account, then log the send and the reply on **/engine** or from the CLI. Tracking links (`/api/t/<token>`) record each click with a timestamp. A seed test reports **passed** only when every expected event (scheduled, sent, click, reply) has been observed on every allowlisted channel.

### Automated tests

```bash
npm test
```

There are 77 tests in `tests/` and they don't need a database. They cover qualification rules and rejection reasons, activity window boundaries, missing or malformed evidence, duplicate detection, idempotent refresh, CSV column order, escaping and UTF-8, the workbook's dropdown values and completeness formula, export and report reconciliation, country distribution, Priority A selection, message generation and channel limits, segment templates, discovery parsing and signal extraction, published Instagram/LinkedIn links, the Instagram Business Discovery lookup, language detection, observed need signals, the entity check (quote location and wording), the LLM router (failover, quota rests, audit) and the agent loop on free models, the hashed login session, the production env check, unknown video lengths, the unavailable-channel fallback, webhook auth, test-mode allowlisting, seed-test event logic, failed provider calls, log redaction, outreach-to-pipeline stage sync, and the AI agent guardrails and n8n workflow.

### Scale benchmark

```bash
npm run bench -- --rows 5000
```

This generates **synthetic** rows (every name says "Fixture", and all evidence is on example.com), then times a normal run and a refresh with 5% of rows edited and 5% new. It checks that the export has 0 duplicates and writes `exports/bench/bench-results.json`. It runs as a dry run, so it measures the qualify → score → channel → draft → export pipeline but not database writes. On the author's machine, 5,050 rows took 3.9 s and the 5,250-row refresh took 6.1 s, with 0 export duplicates and $0 cost.

### Submission workbook

```bash
npm run engine -- --runs-json exports/runs.json
npm run workbook -- --template <IncuBrix workbook.xlsx> --leads exports/leads.csv --runs exports/runs.json \
  --runs-map normal=<run_id>,repeat=<run_id>,refresh=<run_id>,failure=<run_id>,recovery=<run_id> \
  --bench exports/bench/bench-results.json --seed-report exports/seed-report.json \
  --repo-url <your repo URL> --out submission/IncuBrix_Submission_Workbook.xlsx
```

`scripts/fill_workbook.py` writes only the yellow input cells and leaves the green formula cells for IncuBrix to recalculate. Here's what it fills:

- **02_LEADS:** the first 1,000 rows of `leads.csv`, sorted by `lead_id`.
- **03_ENGINE_LAUNCH:** the engine-proof cells, the run summary from recorded `engine_runs`, and the launch-kit summary.
- **04_SELF_CHECK:** the minimums, with evidence paths.
- **00_START:** the repository URL and the tools used.

It refuses fixture rows unless you pass `--allow-fixtures` (for demos only). It marks the seed test as passed only when the seed report passes on at least 3 channels.

You must fill the rest yourself: your personal details, the 01_INSIGHT tab (it needs your own use of the product), video links, manual-work disclosure, the declaration and the self-score.

### Known limitations

- **No real lead data is included.** The engine qualifies only what the evidence supports. Monetization, need and contact evidence must come from permitted research or licensed data. Nothing in this repo produces them, and no scraping is done.
- Evidence URLs are checked for format and recency, not fetched. Use the 20-lead audit to spot-check them.
- Run counts for qualified, unverified and rejected describe the batch. Inserted, updated and unchanged describe what was actually persisted. A failed run records partial persistence.
- Message templates are in English and deterministic. Optional AI rewriting is intentionally not implemented so that drafts can't contain unsupported claims.

## AI agent

An LLM agent (Claude Opus 5.5, or a free local model through Ollama in Docker) that selects creators, drafts personalised pitches and suggests pipeline next steps. **It only proposes.** Every action waits in the **/agent** review inbox, where you edit, approve or reject it. Approving runs the app's existing actions, so test-mode allowlisting still applies and LinkedIn and Instagram stay manual. Code-enforced checks block invented contacts, invented evidence and messages missing an opt-out or sender line. An importable n8n workflow (`n8n/creator-agent-workflow.json`) runs the agent on a schedule and emails you when there's something to review.

To use it: set `SENDER_*` and either `ANTHROPIC_API_KEY` or, for the free option, `AGENT_PROVIDER=ollama` after `docker compose up -d`. Then run `npm run db:push` and open **AI agent** in the sidebar. The full guide, including the API, guardrails, n8n setup and costs, is in [`docs/AGENT.md`](docs/AGENT.md).

## Change notes

Each change has a short note in [`docs/changes/`](docs/changes/README.md): why, what changed, how it was checked.

## Database schema

A single Postgres database. The original 7 CRM tables plus 6 engine tables (see `lib/db/schema.ts`):

| Table | Holds |
|---|---|
| `candidates` | Discovered creators awaiting review, with fit score + reasoning |
| `creators` | Approved roster: contact info, stage, rates, notes |
| `outreach` | Drafted / sent pitches and their status |
| `activities` | Per-creator timeline (stage changes, notes, tags, tasks) |
| `tasks` | Follow-ups with due dates (manual + auto-created) |
| `tags` | Free-form labels on creators |
| `campaigns` | Campaign groupings |
| `leads` | One row per creator identity (unique on `identity_key` and `canonical_profile_url`): all 30 export fields, qualification checks, score factors, channel recommendation |
| `lead_evidence` | Evidence items per lead (content, monetization, need, contacts, country, profile) with checked timestamps |
| `outreach_messages` | 3 channels × 3 steps per lead, unique on `(lead_id, channel, sequence)`, with status, edits, approvals and evidence refs |
| `engine_runs` | Run history: timings, counts, cost, API units, errors |
| `seed_tests`, `seed_test_events` | Seed-test runs and their timestamped scheduled/sent/click/reply events |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `DATABASE_URL is not set` | Create `.env.local` from `.env.example` and add your Neon connection string. |
| Can't connect to a local Postgres | The app uses `@neondatabase/serverless` over HTTP, which only talks to Neon. Use a free Neon database, or run a local Neon HTTP proxy and configure `neonConfig.fetchEndpoint` in `lib/db/index.ts`. |
| `db:push` says "No changes detected" | Your tables already match the schema. Nothing to do. |
| `Another next dev server is already running` | A dev server for this folder is already up (usually on port 3000). Use it, or stop it with the PID shown in the message. |
| Login page keeps reappearing | The password must exactly match `APP_PASSWORD`. Restart `npm run dev` after editing `.env.local`. |
| AI scores look generic | Set `ANTHROPIC_API_KEY` and write a specific `BRAND_CONTEXT`. Then re-score with `scripts/rescore-pending.ts`. |
| Every lead is `unverified` with `message: …` | Set `SENDER_NAME`, `SENDER_ROLE` and `SENDER_COMPANY`. Messages must identify the sender. |
| "Cannot approve: sender identity not configured" | Same fix, in the environment the web server reads (`.env.local` locally, Vercel env vars in production) |
| Leads that qualified last week are now `unverified` | Time windows are re-evaluated on every run. Re-check the evidence and update `checked_date`. |
| `npm run engine` exits 1 | Read the `errors` array in the output, or the run on **/engine**. Fix the cause and rerun: reruns are idempotent. |
| Seed test refuses to send | The recipient must match an entry in `SEED_TEST_ALLOWLIST` exactly (case and a leading `@` are ignored) |

---

## Security notes

This app gates access behind a single shared `APP_PASSWORD` and stores creator contact data. Before running it for real:

- **Set a strong, unique `APP_PASSWORD`** and a `CRON_SECRET` in production.
- **Never commit secrets or real creator data.** `.env*.local`, `*.db`, and `*.csv` are git-ignored. Keep it that way.
- The shared-password gate is intentionally simple. For multi-user or higher-stakes deployments, swap in real auth (e.g. [Clerk](https://clerk.com), Auth0) and per-user roles.
- Run `npm audit` and update dependencies before deploying.
- Webhooks (`/api/apify/webhook`, `/api/engine/ingest`) use a constant-time bearer check and reject every request in production when no secret is set. `/api/discover` no longer trusts the client-settable `x-vercel-cron` header.
- Keep `OUTREACH_MODE=test` until you've reviewed the drafts. The engine never sends on its own, and test mode blocks anyone who isn't on your allowlist.
- `exports/` is git-ignored because it contains contact data. Engine logs and `engine_runs.errors` redact email addresses and API keys.
- You are responsible for how you contact creators. Follow applicable marketing/email regulations (CAN-SPAM, GDPR, FTC disclosure rules) in your jurisdiction.

## License

[MIT](./LICENSE). Free to use, modify, and self-host.
