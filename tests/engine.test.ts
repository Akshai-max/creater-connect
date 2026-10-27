// End-to-end dry run through the real CLI code path (file provider → CSV out).
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse } from "csv-parse/sync"
import { runEngine } from "../lib/leads/engine"
import { LEAD_COLUMNS } from "../lib/leads/export"
import { FIXTURE_NOW, FIXTURE_ROWS, FIXTURE_SENDER, toCsv } from "./fixtures/rows"

function withSender<T>(fn: () => Promise<T>) {
  const prev = { ...process.env }
  Object.assign(process.env, { SENDER_NAME: FIXTURE_SENDER.name, SENDER_ROLE: FIXTURE_SENDER.role, SENDER_COMPANY: FIXTURE_SENDER.company, SENDER_POSTAL_ADDRESS: FIXTURE_SENDER.postalAddress })
  return fn().finally(() => { process.env = prev })
}

test("dry run: CSV in → leads.csv, audit CSV, report and outreach folder out", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-"))
  const input = path.join(dir, "in.csv")
  fs.writeFileSync(input, toCsv(FIXTURE_ROWS))
  const out = path.join(dir, "out")
  const s = await withSender(() => runEngine({ provider: "file", input, dryRun: true, outDir: out, now: FIXTURE_NOW }))

  assert.equal(s.status, "succeeded", JSON.stringify(s.errors))
  assert.equal(s.totalInput, 12)
  assert.equal(s.duplicates, 1)
  assert.equal(s.failed, 1)
  assert.equal(s.qualified, 4)
  assert.equal(s.qualified + s.unverified + s.rejected + s.duplicates + s.failed, s.totalInput)

  const official = parse(fs.readFileSync(path.join(out, "leads.csv"), "utf8"), { columns: true }) as Record<string, string>[]
  assert.equal(official.length, 4)
  assert.deepEqual(Object.keys(official[0]), [...LEAD_COLUMNS])
  assert.ok(official.every((r) => r.priority === "A"))
  const all = parse(fs.readFileSync(path.join(out, "leads-all.csv"), "utf8"), { columns: true }) as Record<string, string>[]
  assert.equal(all.length, 10)
  assert.ok(all.filter((r) => r.candidate_status !== "Qualified").every((r) => r.rejection_reason && r.priority === ""))

  const report = JSON.parse(fs.readFileSync(path.join(out, "validation-report.json"), "utf8"))
  assert.equal(report.official.rows, 4)
  assert.equal(report.official.duplicates, 0)

  const md = fs.readdirSync(path.join(out, "outreach")).filter((f) => f.startsWith("L-"))
  assert.equal(md.length, 4)
  const sample = fs.readFileSync(path.join(out, "outreach", md[0]), "utf8")
  for (const h of ["## email", "## linkedin", "## instagram", "### Initial", "### Follow-up 1", "### Follow-up 2"]) assert.ok(sample.includes(h), h)

  // Segment templates: 3 segments × 3 channels × (initial + 2 follow-ups).
  const seg = fs.readFileSync(path.join(out, "outreach", "_SEQUENCES_BY_SEGMENT.md"), "utf8")
  for (const label of ["Podcaster/Video Podcaster", "YouTuber/Video-First Creator", "Expert-Led Creator"]) assert.ok(seg.includes(`## ${label}`), label)
  assert.equal(seg.match(/^#### /gm)!.length, 27)
  assert.equal(seg.match(/unsubscribe|no thanks/g)!.length >= 27, true)
})

test("dry run with a broken input file fails the run and reports why", async () => {
  const s = await runEngine({ provider: "file", input: path.join(os.tmpdir(), "nope.csv"), dryRun: true, outDir: fs.mkdtempSync(path.join(os.tmpdir(), "e2-")) })
  assert.equal(s.status, "failed")
  assert.match(s.errors.at(-1)!.message, /input not found/)
})
