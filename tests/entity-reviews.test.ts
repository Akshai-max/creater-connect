import { test } from "node:test"
import assert from "node:assert/strict"
import { processBatch, emptyIndex } from "../lib/leads/process"
import { aboutUrl, applyEntityReview, isDecision } from "../lib/leads/entity-reviews"
import { FIXTURE_NOW, FIXTURE_ROWS, FIXTURE_SENDER } from "./fixtures/rows"

const run = (row: Record<string, unknown>) =>
  processBatch([{ row, ref: "r1" }], emptyIndex(), { now: FIXTURE_NOW, source: "test", sender: FIXTURE_SENDER }).processed[0]
const entity = (row: Record<string, unknown>) => run(row).qualification.checks.find((c) => c.id === "entity")!

test("a person's 'one creator runs it' passes the entity check, with the About page as evidence", () => {
  const row: Record<string, unknown> = { ...FIXTURE_ROWS[0], entity_type: "needs_review", entity_evidence_url: "", review_notes: "CONFIRM: individual creator (not company/network); FIND: x" }
  assert.equal(entity(row).pass, false)
  const changed = applyEntityReview(row, { decision: "individual", evidenceUrl: null, note: null, reviewedAt: "2026-10-31T06:00:00Z" })
  assert.equal(changed, true)
  assert.equal(entity(row).pass, true)
  assert.equal(row.entity_source, "human:2026-10-31")
  assert.equal(row.entity_evidence_url, aboutUrl(String(row.profile_url)))
  assert.match(String(row.review_notes), /CHECKED: entity "individual" by a person/)
  assert.doesNotMatch(String(row.review_notes), /CONFIRM: individual creator/)
  // Applying the same review again changes nothing.
  assert.equal(applyEntityReview(row, { decision: "individual", evidenceUrl: null, note: null, reviewedAt: "2026-10-31T06:00:00Z" }), false)
})

test("a person's 'brand' rejects the lead, and wins over an AI verdict", () => {
  const row: Record<string, unknown> = { ...FIXTURE_ROWS[0], entity_type: "individual", entity_source: "ai:groq/x" }
  applyEntityReview(row, { decision: "brand", evidenceUrl: null, note: null, reviewedAt: "2026-10-31T06:00:00Z" })
  const p = run(row)
  assert.equal(p.qualification.status, "rejected")
  assert.equal(entity(row).severity, "reject")
})

test("only known decisions are accepted", () => {
  assert.ok(isDecision("individual") && isDecision("fan_account"))
  assert.ok(!isDecision("maybe") && !isDecision(""))
  assert.equal(aboutUrl("https://www.youtube.com/channel/UC1/"), "https://www.youtube.com/channel/UC1/about")
  assert.equal(aboutUrl("https://www.youtube.com/@x/about"), "https://www.youtube.com/@x/about")
})
