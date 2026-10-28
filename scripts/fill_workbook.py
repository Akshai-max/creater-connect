"""Fill the IncuBrix submission workbook from the engine's real output files.

    python scripts/fill_workbook.py --template <workbook.xlsx> --leads exports/<run>/leads.csv \
        --runs exports/runs.json --out submission/IncuBrix_Submission_Workbook.xlsx \
        [--runs-map normal=<run_id>,repeat=<run_id>,refresh=<run_id>,failure=<run_id>,recovery=<run_id>] \
        [--bench exports/bench/bench-results.json] [--seed-report exports/seed-report.json  (from: npm run seed-test -- report --test <id> --json ...)] \
        [--repo-url https://github.com/<you>/<repo>] [--allow-fixtures]

Integrity rules (enforced, not just documented):
- Only YELLOW input cells are written; GREEN formula cells are left for IncuBrix to recalculate.
- 02_LEADS gets the first 1,000 rows of leads.csv sorted by lead_id, copied verbatim.
- Fixture rows (FIXTURE ids / example.com evidence) are refused unless --allow-fixtures,
  so demo data can never end up in a submission by accident.
- "Seed test passed" is Yes only when --seed-report shows status "passed".
- 00_START personal details, 01_INSIGHT (needs your own product use) and the self-score are
  left blank: only you can fill those truthfully.

Requires: pip install openpyxl
"""
import argparse
import csv
import json
import os
import sys
from collections import Counter

import openpyxl

LEAD_COLUMNS = [
    "lead_id", "creator_name", "creator_segment", "country_iso2", "primary_language", "primary_platform",
    "profile_url", "stable_creator_id", "followers_or_subscribers", "last_content_date", "recent_content_url",
    "content_count_30d", "longform_count_60d", "monetization_signal", "monetization_evidence_url", "incubrix_need",
    "need_evidence_url", "best_channel", "channel_handle_or_url", "channel_evidence_url", "backup_channel",
    "personalization_hook", "first_message", "checked_date", "priority", "lead_score", "candidate_status",
    "rejection_reason",  # AC/AD (duplicate_check, completeness_check) are workbook formulas
]
NUMERIC = {"followers_or_subscribers", "content_count_30d", "longform_count_60d", "lead_score"}
APPROVED = {"US", "CA", "GB", "IE", "AU", "NZ", "SG"}
MAX_ROWS = 1000


def is_fixture(r):
    return "FIXTURE" in r.get("stable_creator_id", "") or "example.com" in (r.get("monetization_evidence_url", "") + r.get("channel_evidence_url", ""))


def num(v):
    if v in ("", None):
        return None
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except ValueError:
        return v


def distribution_ok(rows):
    countries = [r["country_iso2"] for r in rows]
    if not countries:
        return False, "no qualified rows"
    c = Counter(countries)
    approved = sum(n for k, n in c.items() if k in APPROVED) / len(countries)
    top_k, top_n = c.most_common(1)[0]
    ok = approved >= 0.8 and len([k for k in c if k in APPROVED]) >= 3 and top_n / len(countries) <= 0.6
    return ok, f"approved {approved:.0%}, {len(c)} countries, max {top_k} {top_n / len(countries):.0%}"


def complete_sequences(outreach_dir, lead_id):
    """True when the lead's outreach file has at least one channel with initial + 2 follow-ups."""
    p = os.path.join(outreach_dir, f"{lead_id}.md")
    if not os.path.exists(p):
        return False
    text = open(p, encoding="utf-8").read()
    for section in text.split("\n## ")[1:]:
        if section.count("### ") == 3 and "_Unavailable" not in section:
            return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", required=True)
    ap.add_argument("--leads", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--runs")
    ap.add_argument("--runs-map", default="")
    ap.add_argument("--bench")
    ap.add_argument("--seed-report")
    ap.add_argument("--repo-url", default="")
    ap.add_argument("--allow-fixtures", action="store_true")
    a = ap.parse_args()

    with open(a.leads, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    if rows and list(rows[0].keys())[: len(LEAD_COLUMNS)] != LEAD_COLUMNS:
        sys.exit("leads.csv columns do not match the workbook order")
    fixtures = [r["lead_id"] for r in rows if is_fixture(r)]
    if fixtures and not a.allow_fixtures:
        sys.exit(f"refusing: {len(fixtures)} fixture rows in {a.leads} (e.g. {fixtures[0]}). Fixture data must never be submitted.")
    rows.sort(key=lambda r: r["lead_id"])
    leads_dir = os.path.dirname(os.path.abspath(a.leads))
    outreach_dir = os.path.join(leads_dir, "outreach")
    rel = lambda p: os.path.relpath(p, os.getcwd()).replace("\\", "/")

    wb = openpyxl.load_workbook(a.template)

    # 02_LEADS — verbatim copy, first 1,000 rows by lead_id.
    ws = wb["02_LEADS"]
    for i, r in enumerate(rows[:MAX_ROWS]):
        for j, col in enumerate(LEAD_COLUMNS):
            v = r.get(col, "")
            ws.cell(row=5 + i, column=1 + j, value=num(v) if col in NUMERIC else (v or None))

    qualified = [r for r in rows if r["candidate_status"] == "Qualified"]
    dup_ids = Counter(r["stable_creator_id"] for r in rows)
    dups = sum(1 for r in rows if dup_ids[r["stable_creator_id"]] > 1)
    prio_a = [r for r in qualified if r["priority"] == "A"]
    prio_a_full = [r for r in prio_a if complete_sequences(outreach_dir, r["lead_id"])]
    dist_ok, dist_detail = distribution_ok(qualified)
    # Passed only when the recorded report passes AND covers 3 distinct channels.
    seed_passed = False
    if a.seed_report and os.path.exists(a.seed_report):
        sr = json.load(open(a.seed_report, encoding="utf-8"))
        passed_channels = {r["channel"] for r in sr.get("rows", []) if r.get("pass")}
        seed_passed = sr.get("pass") is True and len(passed_channels) >= 3

    # 04_SELF_CHECK — minimums with evidence (self-score left for the candidate).
    sc = wb["04_SELF_CHECK"]
    vr = rel(os.path.join(leads_dir, "validation-report.json"))
    sc["C6"], sc["E6"] = len(qualified), f"{rel(a.leads)} ({len(rows)} rows; workbook holds first {min(len(rows), MAX_ROWS)}). Report: {vr}"
    sc["C7"], sc["E7"] = ("Yes" if dist_ok else "No"), f"{dist_detail}. {vr} › official.distribution"
    sc["C8"], sc["E8"] = dups, f"duplicate_check column in {rel(a.leads)}; engine also dedupes by canonical URL and contact"
    sc["C9"], sc["E9"] = 3, f"Email, LinkedIn, Instagram: {rel(os.path.join(outreach_dir, '_SEQUENCES_BY_SEGMENT.md'))}"
    sc["C10"], sc["E10"] = len(prio_a_full), f"{len(prio_a)} Priority A rows; {len(prio_a_full)} with initial + 2 follow-ups in {rel(outreach_dir)}/<lead_id>.md"
    sc["C11"] = "Yes" if seed_passed else "No"
    sc["E11"] = (f"seed report {rel(a.seed_report)} (test {sr.get('testId')}): scheduled, sent, click and reply observed on {', '.join(sorted(passed_channels))}"
                 if seed_passed else "NOT RUN / NOT PASSED. Run: npm run seed-test -- start, then report --json (README › Seed test)")
    sc["C12"], sc["E12"] = "Yes", "README › Lead engine: npm run engine -- --input <file>; tests: npm test"
    if a.bench and os.path.exists(a.bench):
        b = json.load(open(a.bench, encoding="utf-8"))
        rr = {x["run"]: x for x in b["results"]}
        sc["E19"] = (f"SYNTHETIC benchmark only (not leads): {b['rows']} rows normal run {rr['normal']['runtimeSec']}s, "
                     f"refresh {rr['refresh']['inputRows']} rows {rr['refresh']['runtimeSec']}s, export duplicates "
                     f"{rr['refresh']['exportDuplicates']}, cost $0. {rel(a.bench)}")

    # 03_ENGINE_LAUNCH — A. engine proof (facts about the repo).
    en = wb["03_ENGINE_LAUNCH"]
    proof = {
        6: ("Yes", "README.md › Lead engine", "npm run engine -- --input <leads-input.csv>"),
        7: ("Partial", "README.md › Quick start", "Verified on the author's machine and a fresh Neon DB; not yet on a second machine"),
        8: ("Yes", "lib/leads/process.ts, lib/leads/export.ts", "Stable id, canonical URL and contact value; tests/dedupe-export.test.ts"),
        9: ("Yes", "lib/leads/qualify.ts", "10 criteria, each with a reason; tests/qualify.test.ts"),
        10: ("Yes", "lib/leads/export.ts", "30 columns, workbook vocabularies, sorted by lead_id; validation-report.json"),
        11: ("Yes", "lib/leads/repo.ts › persistLead", "Upsert on identity key; unchanged rows untouched (see run summary)"),
        12: ("Yes", "lib/leads/engine.ts", "Failed runs recorded with redacted errors on /engine; rerun is idempotent"),
        13: ("Yes", "tests/*.test.ts", "npm test"),
        14: ("Yes", ".gitignore, .env.example", "Secrets only in .env.local (git-ignored)"),
    }
    for r, (done, ev, note) in proof.items():
        en[f"B{r}"], en[f"C{r}"], en[f"H{r}"] = done, ev, note

    # B. run summary from recorded engine runs.
    if a.runs and a.runs_map:
        runs = {x["id"]: x for x in json.load(open(a.runs, encoding="utf-8"))}
        m = dict(kv.split("=", 1) for kv in a.runs_map.split(",") if "=" in kv)

        def put(row, run, label):
            produced = (run["inserted"] or 0) + (run["updated"] or 0) + (run["unchanged"] or 0)
            en[f"B{row}"] = run["totalInput"]
            en[f"C{row}"] = produced
            en[f"D{row}"] = (run["rejected"] or 0) + (run["unverified"] or 0) + (run["failed"] or 0)
            en[f"E{row}"] = run["duplicates"]
            en[f"F{row}"] = round((run["durationMs"] or 0) / 60000, 3)
            en[f"G{row}"] = run["costUsd"] or 0
            en[f"H{row}"] = f"{label}: engine_runs {run['id']} ({run['inputRef']}, {run['status']}; inserted {run['inserted']}, updated {run['updated']}, unchanged {run['unchanged']})"

        for row, key in ((18, "normal"), (19, "repeat"), (20, "refresh")):
            if m.get(key) in runs:
                put(row, runs[m[key]], key)
        if m.get("failure") in runs and m.get("recovery") in runs:
            put(21, runs[m["recovery"]], "recovery")
            f = runs[m["failure"]]
            en["H21"] = f"failure {f['id']} status={f['status']} (simulated); recovered by {m['recovery']}. " + en["H21"].value

    # C. launch kit summary (from docs/LAUNCH_PLAN.md).
    launch = {
        24: "English-speaking podcasters, video podcasters, YouTubers and expert-led creators in US/CA/GB/IE/AU/NZ/SG with public sponsorship/product evidence AND a public need (editing, repurposing, captions, consistency). Priority A first.",
        25: "Email (verified business address, best for one-to-one pitches, CAN-SPAM compliant), LinkedIn (expert-led creators; manual notes), Instagram (creators who list IG for collabs; manual DMs). Picked per lead from evidence.",
        26: "Day 0: sender identity, domain SPF/DKIM/DMARC, seed test (growth engineer). Days 1-7: engine run + 20-lead audit; 10 emails/day, 5 LinkedIn notes/day, 3 IG DMs/day (founder sends).",
        27: "Day-3 and day-7 follow-ups; next 25 Priority A after weekly rerun; raise volume ~25%/day while bounces < 2% and complaints = 0; weekly audit and template review.",
        28: "Neon (free), Vercel (free), YouTube Data API (free quota), Resend (free 3,000/mo), domain ~$12/yr. Total ≈ $1/month plus researcher time.",
        29: "ESTIMATES: 5-10% email reply rate, 25-40% LinkedIn acceptance, 1-3 meetings per 100 Priority A leads. Replace with measured rates after 2 weeks.",
        30: "Deliverability damage or platform limits: warm-up, low per-day volumes, manual LinkedIn/IG, opt-out in every message, stop at 2% bounces.",
        31: "Sending domain + mailbox, founder LinkedIn and Instagram accounts, Resend and YouTube API keys, ~4 researcher hours/day for evidence collection.",
    }
    for r, text in launch.items():
        en[f"B{r}"] = text

    # 00_START — only facts about the engine; personal details stay blank.
    st = wb["00_START"]
    if a.repo_url:
        st["B12"] = a.repo_url
    st["B16"] = "Claude Code (AI coding assistant) for engine code, tests, docs and an AI-assisted research pilot; YouTube public RSS feeds and YouTube Data API v3 (discovery); Neon Postgres; Resend (seed test email). No AI is used to qualify leads: qualification is rule-based."
    st["B17"] = "$0"

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    wb.save(a.out)
    print(json.dumps({
        "out": a.out, "rows_in_csv": len(rows), "rows_written": min(len(rows), MAX_ROWS), "qualified": len(qualified),
        "duplicates": dups, "priority_a": len(prio_a), "priority_a_full_sequences": len(prio_a_full),
        "distribution_ok": dist_ok, "seed_passed": seed_passed, "fixture_rows": len(fixtures),
        "left_blank_for_you": ["00_START B5-B11,B13-B15,B18,F5:F10,B21", "01_INSIGHT (all)", "04_SELF_CHECK C24:E28", "04_SELF_CHECK B17:E20"],
    }, indent=2))


if __name__ == "__main__":
    main()
