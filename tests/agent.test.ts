import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { validatePitch, validateRationale, type PitchContext, type PitchDraft } from "../lib/agent/guardrails"
import { agentModel, costUsd } from "../lib/agent/config"
import { AGENT_SYSTEM_PROMPT, buildTask } from "../lib/agent/prompt"
import { FIXTURE_SENDER } from "./fixtures/rows"

const ctx: PitchContext = {
  sender: FIXTURE_SENDER,
  knownRecipients: ["fixture1@example.com"],
  allowedEvidence: ["https://www.youtube.com/watch?v=fx1v0", "https://example.com/fixture1/hiring-editor"],
  contentRefs: [{ title: "Fixture fx1v episode 4: workflow notes", url: "https://www.youtube.com/watch?v=fx1v0" }],
  isFirstMessage: true,
}
const good: PitchDraft = {
  channel: "email",
  recipient: "fixture1@example.com",
  subject: "Idea for your workflow episode",
  body: `Hi Fixture,\n\nYour episode "Fixture fx1v episode 4: workflow notes" was great. ${FIXTURE_SENDER.name}, ${FIXTURE_SENDER.role} at ${FIXTURE_SENDER.company}.\n\nIf you'd rather not get emails from me, reply "unsubscribe".`,
  evidenceUrls: ["https://www.youtube.com/watch?v=fx1v0"],
}

test("a grounded, compliant pitch passes the guardrails", () => {
  assert.deepEqual(validatePitch(good, ctx), [])
})

test("guardrails reject invented contacts and evidence", () => {
  const p = validatePitch({ ...good, recipient: "guessed@fixture.test", evidenceUrls: ["https://made-up.example/sponsor"] }, ctx)
  assert.ok(p.some((x) => /not a published email contact/.test(x)), p.join())
  assert.ok(p.some((x) => /not in stored evidence/.test(x)), p.join())
  assert.ok(validatePitch({ ...good, evidenceUrls: [] }, ctx).some((x) => /cite at least one/.test(x)))
  assert.ok(validatePitch({ ...good, recipient: null }, { ...ctx, knownRecipients: [] }).some((x) => /no published email contact/.test(x)))
})

test("guardrails require sender, opt-out, subject, content reference and length limits", () => {
  assert.ok(validatePitch(good, { ...ctx, sender: null }).some((x) => /sender identity not configured/.test(x)))
  assert.ok(validatePitch({ ...good, body: good.body.replace(/unsubscribe/, "stop") }, ctx).some((x) => /opt-out/.test(x)))
  assert.ok(validatePitch({ ...good, subject: "" }, ctx).some((x) => /subject/.test(x)))
  assert.ok(validatePitch({ ...good, body: good.body.replace("Fixture fx1v episode 4: workflow notes", "your show") }, ctx).some((x) => /specific content/.test(x)))
  assert.ok(validatePitch({ ...good, channel: "instagram", body: good.body + "x".repeat(800) }, ctx).some((x) => /instagram limit/.test(x)))
  assert.ok(validatePitch({ ...good, body: good.body.replace(FIXTURE_SENDER.company, "Someone") }, ctx).some((x) => /name the sender/.test(x)))
})

test("handles and URLs compare loosely (case, @, trailing slash)", () => {
  const ig = { ...ctx, knownRecipients: ["@Fixture_Creator_1"] }
  const body = good.body.replace(`If you'd rather not get emails from me, reply "unsubscribe".`, `If you'd rather not hear from me, reply "no thanks".`)
  assert.deepEqual(validatePitch({ ...good, channel: "instagram", subject: null, recipient: "fixture_creator_1", body, evidenceUrls: ["https://www.youtube.com/watch?v=fx1v0/"] }, ig), [])
})

test("rationale and confidence are required", () => {
  assert.ok(validateRationale("too short", 0.5).length > 0)
  assert.ok(validateRationale("Clear evidence of an editing backlog in the last episode.", 1.4).length > 0)
  assert.deepEqual(validateRationale("Clear evidence of an editing backlog in the last episode.", 0.7), [])
})

test("cost, model default and task prompt", () => {
  assert.equal(agentModel({}), "claude-opus-5-5")
  assert.equal(agentModel({ AGENT_MODEL: "claude-sonnet-5-5" }), "claude-sonnet-5-5")
  assert.equal(costUsd("claude-opus-5-5", 1_000_000, 100_000), 6)
  assert.equal(costUsd("unknown-model", 1000, 1000), 0)
  const t = buildTask(["leads", "pipeline"], 5, "Prioritise UK podcasters")
  assert.match(t, /leads, pipeline/)
  assert.match(t, /at most 5 proposals/)
  assert.match(t, /Prioritise UK podcasters/)
  // The prompt carries the non-negotiables.
  for (const rule of [/never contact anyone/i, /never invent contact details/i, /Qualification is decided by rules/i]) assert.match(AGENT_SYSTEM_PROMPT, rule)
})

test("n8n workflow is valid JSON, every connection points at a real node, and no secret is embedded", () => {
  const raw = fs.readFileSync("n8n/creator-agent-workflow.json", "utf8")
  const wf = JSON.parse(raw) as { nodes: { name: string }[]; connections: Record<string, { main: { node: string }[][] }> }
  const names = new Set(wf.nodes.map((n) => n.name))
  for (const [from, c] of Object.entries(wf.connections)) {
    assert.ok(names.has(from), from)
    for (const out of c.main) for (const t of out) assert.ok(names.has(t.node), t.node)
  }
  assert.match(raw, /\/api\/agent\/run/)
  assert.doesNotMatch(raw, /Bearer\s+\S{8,}|sk-ant|re_[A-Za-z0-9]{10}/)
})
