# Seed test runbook (about 30–45 minutes)

**Goal (brief §1):** "Run your sequences on test accounts you own on 3 channels to prove scheduling, tracking links and reply logging work." The test **passes** only when each of the 3 channels shows all 4 events: `scheduled`, `sent`, `click` and `reply`.

**Rules:** use only accounts you own. In test mode the engine refuses any recipient that isn't on your allowlist.

## What you need

| Channel | Sender (you) | Recipient (also you) |
|---|---|---|
| Email | A Resend account. The free tier works: with the default `onboarding@resend.dev` sender, Resend only delivers to the email you signed up with, which is exactly what a seed test needs. | The email address you signed up to Resend with |
| LinkedIn | Your main LinkedIn account | A second LinkedIn account you own. If you have only one, send the message to yourself as a saved draft and screenshot it. |
| Instagram | Your main Instagram account | A second Instagram account you own (for example a test account) |

## Step 1: configure `.env.local`

```bash
SENDER_NAME=Your Name
SENDER_ROLE=Growth Engineer (assessment)
SENDER_COMPANY=Your own name or project (do NOT present yourself as an IncuBrix employee)
SENDER_POSTAL_ADDRESS=Your postal address (required by CAN-SPAM)
RESEND_API_KEY=re_...                     # from resend.com → API Keys
OUTREACH_FROM_EMAIL=onboarding@resend.dev # or an address on a domain you verified in Resend
OUTREACH_MODE=test
SEED_TEST_ALLOWLIST=email:you@yourmail.com,linkedin:https://www.linkedin.com/in/your-test-profile,instagram:@your_test_account
APP_BASE_URL=http://localhost:3000        # where tracking links point (use your Vercel URL if testing from a phone)
SEED_TEST_TARGET_URL=https://example.org  # where a tracking link redirects after logging the click
```

Restart `npm run dev` after editing the file.

## Step 2: start the test (this logs `scheduled`, and `sent` for email)

```bash
npm run seed-test -- start
```

The command prints a test id (`seed_…`) and one message per channel. Each message contains a unique tracking link `…/api/t/<token>`.
- **Email:** sent automatically through Resend, and `sent` is logged.
- **LinkedIn and Instagram:** the message is printed. Copy it and send it by hand from your main account to your test account. Neither platform allows automated sending.

## Step 3: log the manual sends

```bash
npm run seed-test -- mark-sent --test <seed_id> --channel linkedin
npm run seed-test -- mark-sent --test <seed_id> --channel instagram
```

You can also use the **Mark sent** buttons on **/engine**.

## Step 4: click each tracking link (this logs `click`)

Open the email in your inbox, the LinkedIn DM and the Instagram DM on the **recipient** accounts, and click the link in each one. Each click is logged with a timestamp, then redirects. If you click on a phone, `APP_BASE_URL` must be reachable from the phone, for example your deployed Vercel URL.

## Step 5: reply from each test account, then log the reply (this logs `reply`)

Reply to each message from the recipient account, then run:

```bash
npm run seed-test -- reply --test <seed_id> --channel email
npm run seed-test -- reply --test <seed_id> --channel linkedin
npm run seed-test -- reply --test <seed_id> --channel instagram
```

You can also use the **Log reply** buttons on **/engine**.

## Step 6: produce the proof

```bash
npm run seed-test -- report --test <seed_id> --json exports/seed-report.json
```

- Exit code 0 means `"pass": true`, with every channel showing scheduled, sent, click and reply.
- Exit code 2 means something is missing, and the report lists exactly which event.

Keep these as evidence for the workbook (04_SELF_CHECK row 11) and for the video:
- `exports/seed-report.json`
- a screenshot of **/engine** showing the 4 events per channel
- screenshots of the received email, the LinkedIn DM and the Instagram DM, each with its reply

Then fill the workbook with `npm run workbook -- … --seed-report exports/seed-report.json`. The filler marks the seed test **Yes** only if the report passes on 3 channels.

## Troubleshooting

| Problem | Fix |
|---|---|
| `refused: … not on SEED_TEST_ALLOWLIST` | The recipient must match the allowlist exactly. Check `@` handles and the LinkedIn URL. |
| Email `sent` but nothing arrives | With `onboarding@resend.dev`, Resend only delivers to your Resend signup email. Check spam. |
| Click not logged | The link must point at a running app (`APP_BASE_URL`). `/api/t/` is public, so no login is needed. |
| Report says `sent` missing for LinkedIn or Instagram | Run `mark-sent` for that channel (step 3) |
