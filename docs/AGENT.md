# AI agent: select, draft, review

The agent reads the CRM, picks the creators worth acting on, drafts personalised messages and suggests next steps. **It never sends anything.** Every action is a proposal in the review inbox on **/agent**. A person edits it, then approves or rejects it. Only an approval runs the app's existing actions (send email, move stage, approve candidate), so test-mode allowlisting, activity logging and auto-tasks all still apply.

```
 n8n schedule ─┐                        ┌─ list_qualified_leads ─┐
 "Run agent" ──┴─► runAgent (Claude) ───┼─ list_review_candidates├─► get_details ─► propose_* ─► agent_proposals (pending)
                   tool runner, Opus 5.5 └─ list_pipeline_creators┘     guardrails ▲                     │
                                                                                    │ problems → redraft   ▼
                                       you on /agent (or n8n with a named reviewer): edit · approve · reject
                                                                                                          │
                          approve ─► send email (Resend, allowlist) · move stage · approve/reject candidate ┘
                                     LinkedIn / Instagram: copy and send by hand
```

## What it does per source

| Source | The agent proposes | On approval |
|---|---|---|
| **Qualified leads** (`/leads`) | A first pitch on the creator's best *published* channel, citing their real recent content | Email: adds the lead to the pipeline and sends through the existing composer (test mode: allowlist only; without Resend it's saved as a draft). LinkedIn/Instagram: marked approved for you to send by hand. |
| **Review queue** (`/candidates`) | Approve or reject, with reasons | Runs the existing approve/reject action |
| **Pipeline** (`/pipeline`) | A follow-up email, a stage move, or mark cold | Sends the follow-up, or moves the stage (which logs the activity and creates auto-tasks) |

## Guardrails (code-enforced, not just prompted)

`lib/agent/guardrails.ts`, tested in `tests/agent.test.ts`:

- **Proposals only.** The agent has no tool that sends, moves a stage or changes a candidate.
- **No invented contacts.** A pitch's recipient must be a contact the creator publishes, from stored evidence.
- **No invented evidence.** Every URL the agent cites must already be stored, and a first message must mention one of the creator's actual content items.
- **Compliance.** Each message must name the sender and company (`SENDER_*`) and include an opt-out. Email needs a subject and a postal address, and every channel has a length limit.
- **Rules decide qualification.** The agent can't pitch a lead that isn't `qualified`.
- **Re-checked on approval.** Edited messages are checked again when you approve them.
- **Limits.** The agent won't make two pending proposals for the same creator. Each run is capped by the maximum proposals (default 10, cap 50) and by 30 model turns.
- **Named reviewer.** The n8n decision endpoint requires a named `reviewer`, so automation can't approve its own work.

## Setup

1. Set these in `.env.local`:
   - `ANTHROPIC_API_KEY`;
   - the `SENDER_*` variables (pitches are rejected without them);
   - optionally `RESEND_API_KEY` and `SEED_TEST_ALLOWLIST`.
2. Run `npm run db:push`. It adds the `agent_runs` and `agent_proposals` tables, and the change is additive.
3. Open **AI agent** in the sidebar, choose your sources, and click **Run agent**. A run takes about 1–3 minutes.

**Model and cost:** the agent uses `claude-opus-5-5` by default; change it with `AGENT_MODEL`. Each run records its tokens, runtime and cost on **/agent**, priced at $4 per million input tokens and $20 per million output tokens for Opus 5.5. The system prompt is cached between turns. The server-side refusal fallback (`fallbacks: "default"`) is on: if the model declines a request, the API retries it on a fallback model.

## n8n

Import `n8n/creator-agent-workflow.json`. The workflow runs on a schedule (weekdays at 09:00), calls `POST /api/agent/run`, and does one of two things:
- **The run worked and produced proposals:** it emails you a digest and a link to **/agent**.
- **The run failed:** it emails you an alert.

To set it up in n8n:
1. Open **Workflows → Import from file** and choose `n8n/creator-agent-workflow.json`.
2. In **Config (edit me)**, set `crmBaseUrl` (your deployed URL) and `reviewerEmail`.
3. Create a **Header Auth** credential named "Creator CRM agent token" with the name `Authorization` and the value `Bearer <AGENT_WEBHOOK_SECRET>`.
4. Create an **SMTP** credential, or swap the email nodes for Slack or Gmail.
5. Activate the workflow.

### API

All three endpoints need `Authorization: Bearer ${AGENT_WEBHOOK_SECRET}`. They're open in local dev when no secret is set, and closed in production.

| Endpoint | Body / query | Returns |
|---|---|---|
| `POST /api/agent/run` | `{ sources?: ["leads","candidates","pipeline"], instructions?, maxProposals?, includeFixtures? }` | The run summary, `reviewUrl` and the pending proposals. HTTP 502 if the run failed. |
| `GET /api/agent/proposals` | `?status=pending\|approved\|rejected\|sent\|failed&runId=` | Proposals |
| `POST /api/agent/proposals/:id` | `{ decision: "approve"\|"reject", reviewer: "Name", subject?, body?, note? }` | The decision result. HTTP 409 if the proposal is already decided or fails the checks. |

## Files

| File | What it does |
|---|---|
| `lib/agent/agent.ts` | The tools and the run loop (`client.beta.messages.toolRunner`) |
| `lib/agent/guardrails.ts` | Pure validation |
| `lib/agent/prompt.ts` | The system prompt and task |
| `lib/agent/config.ts` | Model, limits and pricing |
| `app/agent/` | The `/agent` page, server actions and `decide.ts` (approval logic) |
| `app/api/agent/` | The n8n endpoints |
| `n8n/creator-agent-workflow.json` | The importable workflow |

## Limits

- The agent is only as good as the stored evidence. With no qualified real leads, it has nothing to pitch, and it says so.
- I haven't run it against the live API from this repo, because no key was configured. With a key, the first run is the real test: review its proposals closely.
- Runs are synchronous, at about 1–3 minutes each. The API route allows up to 300 s, so set n8n's HTTP timeout to match; the workflow uses 300 s.
