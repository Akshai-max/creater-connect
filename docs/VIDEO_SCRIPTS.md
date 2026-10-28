# Video scripts

The brief asks for both videos to be **unedited**. Record each in one take with OBS or Loom, with your mic on. Before you start, run through the "Prep" list for each video, so nothing fails on camera.

---

## Video A: product walkthrough (max 5:00)

This is a walkthrough of **IncuBrix**, the product, as seen by a target creator. Record it during or after the session in `docs/PRODUCT_INSIGHT_TEMPLATE.md`.

**Prep:** IncuBrix logged in, a sample piece of content ready, and your 5 observations open in a note.

| Time | Show | Say (adapt to what you actually saw) |
|---|---|---|
| 0:00–0:20 | Your face or the IncuBrix home screen | "I'm [name]. This is IncuBrix from the point of view of the creators I'm targeting: podcasters, YouTubers and expert-led creators who need help with [editing / repurposing / consistency]." |
| 0:20–1:00 | Onboarding | "Signing up took [N] minutes. [What worked / what was confusing]. That matters because …" (observation 1) |
| 1:00–2:30 | The core feature on real content | Show the upload and the output. "Here's the output from a [length] episode. [Quality]. I had to fix [X]." (observations 2–3) |
| 2:30–3:30 | Publishing, export, collaboration | Observations 4–5. Name anything unavailable, with the date and time. |
| 3:30–4:40 | Your 3 opportunities | "Based on this, the three biggest growth opportunities are … Here's the evidence for each." Label ideas as ideas. |
| 4:40–5:00 | Close | "Everything I've claimed is in workbook tab 01 with evidence links." |

---

## Video B: technical demo (max 8:00)

The brief wants "one normal run, a refresh on new input, and recovery from one simple failure."

**Prep, done once before recording:**

```bash
npm run dev                                   # app on http://localhost:3000, signed in
npm run engine -- --purge-fixtures            # start clean
# have two input files ready:
#   A = data/leads-input.csv          (your researched leads)
#   B = data/leads-input-refresh.csv  (A with ~2 rows edited + ~2 new creators)
```

If you have no real leads yet, record with the fictional fixtures (`tests/fixtures/leads-input.csv`) and **say on camera that they're fixtures**. Never present them as real leads.

| Time | Show | Command / action | Say |
|---|---|---|---|
| 0:00–0:40 | README › Lead engine | Scroll the run command and the rules table | "One command runs the whole pipeline: find, verify, dedupe, qualify, score, pick channels, draft messages, export. Here are the 10 checks; each failure is either *rejected* or *unverified*." |
| 0:40–2:00 | Terminal | `npm run engine -- --input data/leads-input.csv` | "**Normal run.** It parsed N rows, removed D duplicates, qualified Q, and logged runtime and cost." Point at the JSON summary. |
| 2:00–3:00 | Browser **/leads** | Open the Qualified tab, click one lead | "Every check has a reason and an evidence link. Here's the score breakdown, the best and backup channel with why, and the 3×3 messages that cite their real recent episode." Click one evidence link live. |
| 3:00–3:40 | `exports/leads.csv` and `exports/outreach/` | Open them in an editor | "The official CSV has exactly the workbook's 30 columns, sorted by lead_id, plus one Markdown file per Priority A lead and the segment templates." |
| 3:40–4:40 | Terminal | Same command again, with input A | "**Repeat run:** 0 inserted, 0 updated, N unchanged. It's idempotent, so no duplicates." |
| 4:40–5:40 | Terminal | `npm run engine -- --input data/leads-input-refresh.csv` | "**Refresh on new input:** 2 inserted, 2 updated, the rest unchanged. Edited or approved messages are never overwritten." |
| 5:40–7:00 | Terminal, then **/engine** | `npm run engine -- --input data/leads-input-refresh.csv --simulate-failure-after 1`, then the same command without the flag | "**Failure:** the run is recorded as *failed* with a redacted error on /engine. **Recovery:** rerunning the same command succeeds with no duplicates." Show both runs on /engine. |
| 7:00–7:40 | Terminal | `npm test` | "There are automated tests for rules, dedupe, export format, channels, messages, auth and test mode, and they all pass." |
| 7:40–8:00 | /engine seed-test card | — | "The seed test proof on my own 3 accounts is here. Test mode blocks any non-allowlisted recipient. Nothing is ever sent to real creators." |

**For the live review (25 points):** practice tracing a random lead's evidence from `leads.csv` to its source pages. Run `npm run engine -- --input <their file> --dry-run` on a file you haven't seen before. Prepare one honest "decision I'd change". For example: the evidence URLs are format-checked, not fetched, so link rot is only caught by the weekly audit.
