import { test } from "node:test"
import assert from "node:assert/strict"
import { processBatch, emptyIndex } from "../lib/leads/process"
import { computeActivity } from "../lib/leads/qualify"
import { parseLeadRow, withinDays } from "../lib/leads/normalize"
import { FIXTURE_NOW, FIXTURE_ROWS, FIXTURE_SENDER } from "./fixtures/rows"

const run = (rows = FIXTURE_ROWS, sender: any = FIXTURE_SENDER) =>
  processBatch(rows.map((row, i) => ({ row, ref: `row${i + 1}` })), emptyIndex(), { now: FIXTURE_NOW, source: "test", sender })

const byName = (r: ReturnType<typeof run>, name: string) => {
  const p = r.processed.find((x) => x.input.creatorName === name)
  assert.ok(p, `missing ${name}`)
  return p
}
const failing = (p: { qualification: { checks: { id: string; pass: boolean }[] } }) => p.qualification.checks.filter((c) => !c.pass).map((c) => c.id)

test("fully evidenced creators qualify", () => {
  const r = run()
  for (const n of ["Fixture Creator 1", "Fixture Creator 2", "Fixture Creator 3", "Fixture Creator 11"]) {
    const p = byName(r, n)
    assert.equal(p.qualification.status, "qualified", `${n}: ${p.qualification.rejectionReason}`)
    assert.equal(p.qualification.rejectionReason, null)
  }
})

test("excluded entity, non-approved country, guessed contact and inactivity are rejected with reasons", () => {
  const r = run()
  const agency = byName(r, "Fixture Talent Agency")
  assert.equal(agency.qualification.status, "rejected")
  assert.match(agency.qualification.rejectionReason!, /^entity: excluded entity type: agency/)

  const de = byName(r, "Fixture Creator 5")
  assert.equal(de.qualification.status, "rejected")
  assert.match(de.qualification.rejectionReason!, /country DE not approved/)

  const guessed = byName(r, "Fixture Creator 7")
  assert.equal(guessed.qualification.status, "rejected")
  assert.deepEqual(failing(guessed).sort(), ["no_guessing"])

  const inactive = byName(r, "Fixture Creator 9")
  assert.equal(inactive.qualification.status, "rejected")
  assert.match(inactive.qualification.rejectionReason!, /activity: only 1 items in 30d and 1 long-form in 60d/)
})

test("missing and malformed evidence is unverified, never qualified", () => {
  const r = run()
  const missing = byName(r, "Fixture Creator 6")
  assert.equal(missing.qualification.status, "unverified")
  assert.deepEqual(failing(missing), ["monetization", "complete"])

  const malformed = byName(r, "Fixture Creator 12")
  assert.equal(malformed.qualification.status, "unverified")
  assert.match(malformed.qualification.rejectionReason!, /monetization evidence URL missing or malformed/)
})

test("rows without a stable id fail validation instead of being stored", () => {
  const r = run()
  assert.equal(r.failures.length, 1)
  assert.match(r.failures[0].error, /stable_creator_id is required/)
})

test("no sender configured means messages are unavailable and nothing qualifies", () => {
  const r = run(FIXTURE_ROWS.slice(0, 1), null)
  const p = r.processed[0]
  assert.equal(p.qualification.status, "unverified")
  assert.ok(failing(p).includes("message"))
  assert.ok(p.messages.every((m) => m.status === "unavailable" && /Sender identity not configured/.test(m.unavailableReason!)))
})

test("AI fit score fields in input do not affect qualification", () => {
  const row = { ...FIXTURE_ROWS[5], fitScore: 10, ai_fit_score: 10 }
  const p = run([row]).processed[0]
  assert.equal(p.qualification.status, "unverified")
})

test("activity window boundaries are inclusive and ignore future dates", () => {
  const now = new Date("2026-10-27T00:00:00Z")
  assert.equal(withinDays("2026-09-27", 30, now), true) // exactly 30 days
  assert.equal(withinDays("2026-09-26", 30, now), false) // 31 days
  assert.equal(withinDays("2026-10-28", 30, now), false) // future
  assert.equal(withinDays("not-a-date", 30, now), false)

  const mk = (dates: string[], longform = false) => {
    const parsed = parseLeadRow({ ...FIXTURE_ROWS[0], content_items: JSON.stringify(dates.map((d, i) => ({ url: `https://www.youtube.com/watch?v=b${i}`, title: `t${i}`, publishedAt: d, isLongform: longform }))) }, "t")
    assert.ok(parsed.ok)
    return computeActivity(parsed.input, now)
  }
  const eight = Array.from({ length: 8 }, (_, i) => `2026-10-${String(20 - i).padStart(2, "0")}`)
  assert.equal(mk(eight).contentCount30d, 8)
  assert.equal(mk(["2026-08-28", "2026-08-29"], true).longformCount60d, 2) // day 60 and 59
  assert.equal(mk(["2026-08-27", "2026-08-29"], true).longformCount60d, 1) // day 61 excluded
})

test("exactly 7 items in 30d and 1 long-form in 60d is rejected; 8 items qualifies on activity", () => {
  const now = FIXTURE_NOW
  const mkRow = (n: number) => ({
    ...FIXTURE_ROWS[0],
    content_items: JSON.stringify(Array.from({ length: n }, (_, i) => ({ url: `https://www.youtube.com/watch?v=c${i}`, title: `Item ${i}`, publishedAt: new Date(now.getTime() - (i + 1) * 86_400_000).toISOString().slice(0, 10), isLongform: i === 0 }))),
  })
  const r7 = run([mkRow(7)]).processed[0]
  assert.equal(r7.qualification.status, "rejected")
  const r8 = run([mkRow(8)]).processed[0]
  assert.equal(r8.qualification.checks.find((c) => c.id === "activity")!.pass, true)
})

test("stale checked_date makes a lead unverified", () => {
  const p = run([{ ...FIXTURE_ROWS[0], checked_date: "2026-09-01" }]).processed[0]
  assert.equal(p.qualification.status, "unverified")
  assert.ok(failing(p).includes("fresh"))
})
