import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { validatePitch, validateRationale, type PitchContext, type PitchDraft } from "../lib/agent/guardrails"
import { agentModel, agentProvider, costUsd, ollamaUrl } from "../lib/agent/config"
import { checkArgs } from "../lib/agent/ollama"
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

test("provider switch: Ollama is opt-in and has its own model default", () => {
  assert.equal(agentProvider({}), "anthropic")
  assert.equal(agentProvider({ AGENT_PROVIDER: "Ollama" }), "ollama")
  assert.equal(agentModel({ AGENT_PROVIDER: "ollama" }), "qwen3:4b")
  assert.equal(agentModel({ AGENT_PROVIDER: "ollama", OLLAMA_MODEL: "llama3.1:8b", AGENT_MODEL: "claude-opus-5-5" }), "llama3.1:8b")
  assert.equal(ollamaUrl({ OLLAMA_URL: "http://ollama:11434/" }), "http://ollama:11434")
  assert.equal(costUsd("qwen3:4b", 50_000, 5_000), 0)
})

test("local-model tool arguments are coerced and checked against the schema", () => {
  const schema = {
    type: "object",
    properties: {
      subject_type: { type: "string", enum: ["lead", "creator"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
      evidence_urls: { type: "array", items: { type: "string" } },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      subject: { type: "string" },
    },
    required: ["subject_type", "confidence"],
  }
  const ok = checkArgs(schema, '{"subject_type":"lead","limit":"5","evidence_urls":"[\\"https://a.example\\"]","confidence":"0.7","subject":"","extra":1}')
  assert.deepEqual(ok, { args: { subject_type: "lead", limit: 5, evidence_urls: ["https://a.example"], confidence: 0.7 }, problems: [] })
  const bad = checkArgs(schema, { subject_type: "candidate", limit: 99 })
  assert.ok(bad.problems.some((p) => /subject_type must be one of/.test(p)), bad.problems.join())
  assert.ok(bad.problems.some((p) => /limit must be between/.test(p)), bad.problems.join())
  assert.ok(bad.problems.includes("confidence is required"), bad.problems.join())
  assert.deepEqual(checkArgs(schema, "not json").problems, ["arguments are not valid JSON"])
})
