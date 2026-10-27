import { test } from "node:test"
import assert from "node:assert/strict"
import { processBatch, emptyIndex } from "../lib/leads/process"
import { buildExport, buildCsv, csvEscape, LEAD_COLUMNS, type ExportableLead } from "../lib/leads/export"
import { countryDistribution } from "../lib/leads/distribution"
import { assignPriorities } from "../lib/leads/scoring"
import { canonicalUrl, leadIdFor, identityKey } from "../lib/leads/normalize"
import { parse } from "csv-parse/sync"
import { FIXTURE_NOW, FIXTURE_ROWS, FIXTURE_SENDER } from "./fixtures/rows"

const run = (rows: Record<string, unknown>[], index = emptyIndex()) =>
  processBatch(rows.map((row, i) => ({ row, ref: `row${i + 1}` })), index, { now: FIXTURE_NOW, source: "test", sender: FIXTURE_SENDER })

test("duplicate stable id in one input is counted once and skipped", () => {
  const r = run(FIXTURE_ROWS)
  assert.equal(r.duplicates.length, 1)
  assert.equal(r.duplicates[0].of, leadIdFor(identityKey("youtube", String(FIXTURE_ROWS[0].stable_creator_id))))
  const ids = r.processed.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
})

test("same canonical profile URL under a different id is a duplicate", () => {
  const a = FIXTURE_ROWS[0]
  const b = { ...FIXTURE_ROWS[2], profile_url: String(a.profile_url).toUpperCase().replace("HTTPS://WWW.", "https://m.") + "/" }
  assert.equal(canonicalUrl(String(b.profile_url)), canonicalUrl(String(a.profile_url)))
  const r = run([a, b])
  assert.equal(r.duplicates.length, 1)
  assert.match(r.duplicates[0].reason, /canonical profile URL/)
})

test("same published email on a second identity is rejected as duplicate", () => {
  const second = { ...FIXTURE_ROWS[2], email: FIXTURE_ROWS[0].email }
  const r = run([FIXTURE_ROWS[0], second])
  const p = r.processed[1]
  assert.equal(p.qualification.status, "rejected")
  assert.match(p.qualification.rejectionReason!, /unique: duplicate of L-/)
})

test("refresh is idempotent: same input → same ids, unchanged; edited input → changed", () => {
  const first = run(FIXTURE_ROWS)
  const index = emptyIndex()
  for (const p of first.processed) {
    index.byIdentity.set(p.identityKey, { id: p.id, inputHash: p.inputHash })
    index.byCanonicalUrl.set(p.canonicalProfileUrl, p.id)
  }
  const again = run(FIXTURE_ROWS, index)
  assert.deepEqual(again.processed.map((p) => p.id), first.processed.map((p) => p.id))
  assert.ok(again.processed.every((p) => !p.isNew && !p.changed))

  const edited = FIXTURE_ROWS.map((r, i) => (i === 0 ? { ...r, followers_or_subscribers: 99999 } : r))
  const third = run(edited, index)
  assert.equal(third.processed.filter((p) => p.changed).length, 1)
})

test("leads.csv has exactly the 30 columns in order, valid escaping, UTF-8 round trip", () => {
  const r = run(FIXTURE_ROWS)
  const leads = r.processed.map(toExportable)
  leads[0].creatorName = 'Zoë "Quotes", Ünïcode\nNewline'
  const { csv, records } = buildExport(leads, { includeNonQualified: true })
  assert.equal(LEAD_COLUMNS.length, 30)
  assert.equal(csv.split("\r\n")[0], LEAD_COLUMNS.join(","))
  const parsed = parse(Buffer.from(csv, "utf8").toString("utf8"), { columns: true }) as Record<string, string>[]
  assert.equal(parsed.length, records.length)
  assert.deepEqual(Object.keys(parsed[0]), [...LEAD_COLUMNS])
  assert.ok(parsed.some((p: any) => p.creator_name === 'Zoë "Quotes", Ünïcode\nNewline'))
  assert.equal(csvEscape("plain"), "plain")
  assert.equal(csvEscape('a"b'), '"a""b"')
  assert.ok(buildCsv([], { bom: true }).startsWith("﻿lead_id,"))
})

test("export is deterministic and the report reconciles with the CSV", () => {
  const leads = run(FIXTURE_ROWS).processed.map(toExportable)
  const a = buildExport(leads, { now: FIXTURE_NOW })
  const b = buildExport([...leads].reverse(), { now: FIXTURE_NOW })
  assert.equal(a.csv, b.csv)
  const rows = parse(a.csv, { columns: true }) as Record<string, string>[]
  assert.equal(a.report.rows, rows.length)
  assert.equal(a.report.byStatus.qualified, rows.filter((x) => x.candidate_status === "qualified").length)
  assert.equal(a.report.qualifiedComplete, rows.filter((x) => x.completeness_check === "COMPLETE" && x.duplicate_check === "UNIQUE").length)
  assert.ok(rows.every((x) => x.candidate_status === "qualified"), "official export holds only qualified rows")
  assert.ok(rows.every((x) => x.completeness_check === "COMPLETE"), JSON.stringify(rows.map((x) => x.completeness_check)))
})

test("duplicate_check is computed from the exported rows", () => {
  const leads = run(FIXTURE_ROWS).processed.map(toExportable)
  const clone = { ...leads[0], id: "L-ZZZZZZZZZZ" }
  const { records } = buildExport([...leads, clone], { includeNonQualified: true })
  assert.equal(records.find((x) => x.lead_id === "L-ZZZZZZZZZZ")!.duplicate_check, `DUPLICATE:${leads[0].id}`)
  assert.equal(records.find((x) => x.lead_id === leads[0].id)!.duplicate_check, "UNIQUE")
})

test("country distribution rules", () => {
  const ok = countryDistribution(["US", "US", "GB", "CA", "AU"])
  assert.equal(ok.pass, true)
  const tooMuchUS = countryDistribution(["US", "US", "US", "US", "GB"])
  assert.equal(tooMuchUS.checks.find((c) => c.id === "max_share")!.pass, false)
  const twoCountries = countryDistribution(["US", "GB", "US", "GB"])
  assert.equal(twoCountries.checks.find((c) => c.id === "country_count")!.pass, false)
  const offRegion = countryDistribution(["US", "GB", "CA", "DE", "FR"])
  assert.equal(offRegion.checks.find((c) => c.id === "approved_share")!.pass, false)
  assert.equal(offRegion.approvedShare, 0.6)
  assert.equal(countryDistribution([]).pass, false)
})

test("Priority A: top N qualified only, ties by id, unqualified never A", () => {
  const rows = [
    { id: "L-3", status: "qualified" as const, score: 80 },
    { id: "L-1", status: "qualified" as const, score: 80 },
    { id: "L-2", status: "qualified" as const, score: 50 },
    { id: "L-9", status: "unverified" as const, score: 99 },
    { id: "L-8", status: "rejected" as const, score: 98 },
    { id: "L-4", status: "qualified" as const, score: 70 },
  ]
  const p = assignPriorities(rows, 2)
  assert.equal(p.get("L-1"), "A")
  assert.equal(p.get("L-3"), "A")
  assert.equal(p.get("L-4"), "B")
  assert.equal(p.get("L-2"), "C")
  assert.equal(p.get("L-9"), "N/A")
  assert.equal(p.get("L-8"), "N/A")
})

test("missing data scores zero for its factor", () => {
  const r = run([{ ...FIXTURE_ROWS[0], monetization_evidence_url: "", followers_or_subscribers: "" }])
  const f = Object.fromEntries(r.processed[0].factors.map((x) => [x.key, x]))
  assert.equal(f.commercial.points, 0)
  assert.ok(f.fit.points < 10, "unknown audience must not score as core range")
})

function toExportable(p: ReturnType<typeof run>["processed"][number]): ExportableLead {
  return {
    id: p.id, identityKey: p.identityKey, canonicalProfileUrl: p.canonicalProfileUrl, creatorName: p.input.creatorName,
    segment: p.input.segment, countryIso2: p.input.countryIso2, primaryLanguage: p.input.primaryLanguage, primaryPlatform: p.input.primaryPlatform,
    profileUrl: p.input.profileUrl, stableCreatorId: p.input.stableCreatorId, followers: p.input.followers,
    lastContentDate: p.qualification.activity.lastContentDate, recentContentUrl: p.recentContent?.url ?? null,
    contentCount30d: p.qualification.activity.contentCount30d, longformCount60d: p.qualification.activity.longformCount60d,
    monetizationSignal: p.input.monetizationSignal, monetizationEvidenceUrl: p.input.monetizationEvidenceUrl, need: p.input.need,
    needEvidenceUrl: p.input.needEvidenceUrl, bestChannel: p.channels.best, channelHandleOrUrl: p.channels.bestValue,
    channelEvidenceUrl: p.channels.bestEvidenceUrl, backupChannel: p.channels.backup, personalizationHook: p.hook,
    firstMessage: p.firstMessage, checkedDate: p.input.checkedDate, priority: p.qualification.status === "qualified" ? "A" : "N/A",
    leadScore: p.score, candidateStatus: p.qualification.status, rejectionReason: p.qualification.rejectionReason,
  }
}
