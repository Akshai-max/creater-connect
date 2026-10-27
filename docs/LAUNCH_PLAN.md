# Outreach launch plan (draft)

> **Every rate and volume in this document is an estimate, not a measured result.** Nothing has been sent to real prospects yet. Replace the estimates with measured numbers after the first two weeks.

## Roles

| Role | Owner | Responsibilities |
|---|---|---|
| Engine operator | Growth engineer | Runs `npm run engine` daily, watches **/engine** for failures, keeps the evidence inputs fresh |
| Researcher | Growth engineer or a part-time researcher | Collects permitted public evidence (monetization, need, contact routes) into the input CSV and records `checked_date` |
| Reviewer / sender | Founder or growth lead | Reviews Priority A drafts on **/leads/[id]**, approves them, and sends from their own email, LinkedIn and Instagram accounts |
| Data steward | Growth engineer | Handles opt-outs within 24 hours, audits 20 random leads every week, maintains the suppression list |

## Day-by-day (first two weeks)

| Day | Activity |
|---|---|
| 0 | Configure the `SENDER_*` variables, warm up the sending domain (SPF, DKIM, DMARC), and run the seed test until it passes on all three channels |
| 1 | Run the engine on the first research batch. Audit 20 random qualified leads by hand and stop if fewer than 85% hold up. |
| 2–3 | Send to Priority A: 10 emails per day and 5 LinkedIn connection notes per day. Send Instagram DMs only where Instagram is the best channel. |
| 4–5 | Day-3 follow-ups go out (sequence step 2). Log replies on the creator record and move responders to `Replied` in the pipeline. |
| 6–7 | Review the metrics and adjust templates in `lib/leads/messages.ts` if the reply rate is below the floor in the table below |
| 8–10 | Day-7 follow-ups (step 3) for anyone who hasn't replied. Bring in the next 25 Priority A leads after the engine reruns. |
| 11–14 | Raise volume by about 25% per day if bounce rate stays under 2% and spam complaints stay at 0 |

## Safe daily volumes (estimates, per sending account)

| Channel | Start | Ceiling | Reasoning |
|---|---|---|---|
| Email (new domain) | 10/day | 40/day after 2 weeks | Gradual warm-up protects deliverability. Each email is one-to-one and personalized, never a bulk blast. |
| LinkedIn | 5 connection notes/day | ~15/day | Stays well under LinkedIn's weekly invitation limits. Sent by hand. |
| Instagram DM | 3/day | ~10/day | Message requests to non-followers are throttled. Sent by hand, never automated. |

## Expected rates (estimates with reasoning)

| Metric | Estimate | Reasoning |
|---|---|---|
| Email reply rate | 5–10% | Personalized B2B cold email to small creators who have shown a need. Typical published cold-email ranges are low single digits; strong personalization and evidence of need push it higher. |
| LinkedIn acceptance | 25–40% | Accepting a connection is a smaller commitment than replying |
| Reply → meeting | 20–30% | Only an estimate. The first two weeks will set the real baseline. |
| Meetings per 100 Priority A leads | 1–3 | Product of the rows above |

## Tools and budget (estimates)

| Item | Cost |
|---|---|
| Neon Postgres | Free tier |
| Vercel hosting | Free/Hobby tier |
| YouTube Data API | Free quota (about 3 units per channel refresh) |
| Resend | Free tier (3,000 emails per month) |
| Sending domain | About $12 per year |
| Researcher time | The main cost: about 3–5 minutes per lead to verify monetization, need and contact evidence |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Stale evidence (a creator goes quiet) | The 30-day `checked_date` freshness rule plus daily reruns. Leads that go stale drop to `unverified` automatically. |
| Deliverability damage | Warm-up, low volume, opt-out in every email, and a stop if bounces exceed 2% |
| Platform restrictions (LinkedIn, Instagram) | Manual sending only, no automation tools, conservative volumes |
| Wrong contact route | Only published routes with evidence. Spot-check contact details in the weekly 20-lead audit (target ≥90% accurate). |
| Opt-out not honored | Add the contact to the suppression list the same day and mark the lead `Cold` in the pipeline |
| Engine failure | The run is recorded as `failed` with redacted errors, and reruns are idempotent |

## Monitoring and recovery

- **Daily:** check **/engine** for a successful run. Look at the failed and duplicate counts and the export problems on **/leads**.
- **On failure:** read the run's errors, fix the input row or configuration, and rerun the same command. Nothing gets duplicated.
- **Weekly:** do a 20-lead audit (open each evidence URL) and compare reply rates per channel against the estimates above.
