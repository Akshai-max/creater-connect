import { test } from "node:test"
import assert from "node:assert/strict"
import { LlmRouter, type AuditRow, type ProviderCfg } from "../lib/llm/router"
import { runRouterLoop } from "../lib/llm/agent-loop"

const NOW = new Date("2026-10-29T12:00:00Z")
const groq: ProviderCfg = { name: "groq", kind: "openai", baseUrl: "https://groq.test/v1", model: "g", apiKey: "TEST_KEY_G" }
const gemini: ProviderCfg = { name: "gemini", kind: "openai", baseUrl: "https://gemini.test/v1", model: "m", apiKey: "TEST_KEY_M" }

test("the agent loop runs tools through the router and carries on on Gemini when Groq's quota runs out mid-run", async () => {
  const rows: AuditRow[] = []
  const sent: { host: string; body: { messages: { role: string; tool_call_id?: string }[]; tools?: unknown[] } }[] = []
  const script: Record<string, { status: number; body: unknown }[]> = {
    "groq.test": [
      { status: 200, body: { choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "list_qualified_leads", arguments: '{"limit":"3"}' } }] } }] } },
      { status: 429, body: { error: { message: "Rate limit reached on tokens per day (TPD)" } } },
    ],
    "gemini.test": [{ status: 200, body: { choices: [{ message: { content: "Nothing worth pitching today." } }] } }],
  }
  const router = new LlmRouter([groq, gemini], {
    now: () => NOW,
    sink: { async write(r) { rows.push(r) }, async activeCooldowns() { return new Map() } },
    fetcher: async (url, init) => {
      const host = new URL(url).host
      sent.push({ host, body: JSON.parse(init.body) })
      const r = script[host].shift()!
      return { ok: r.status === 200, status: r.status, headers: { get: () => null }, text: async () => JSON.stringify(r.body) }
    },
  })
  const calls: unknown[] = []
  const tools = [{
    name: "list_qualified_leads", description: "list", input_schema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } } },
    run: async (args: never) => { calls.push(args); return JSON.stringify([]) },
  }]
  const r = await runRouterLoop({ router, system: "sys", task: "task", tools, maxIterations: 5, runId: "run1" })

  assert.deepEqual(calls, [{ limit: 3 }]) // "3" coerced to the schema's integer before the tool ran
  assert.equal(r.summary, "Nothing worth pitching today.")
  assert.deepEqual(r.providers, ["groq/g", "gemini/m"])
  assert.deepEqual(sent.map((s) => s.host), ["groq.test", "groq.test", "gemini.test"])
  // Gemini got the whole conversation so far, including the tool result.
  const last = sent[2].body.messages
  assert.deepEqual(last.map((m) => m.role), ["system", "user", "assistant", "tool"])
  assert.equal(last[3].tool_call_id, "c1")
  assert.ok(sent[0].body.tools?.length)
  assert.deepEqual(rows.map((x) => `${x.provider}:${x.status}`), ["groq:ok", "groq:quota_exhausted", "gemini:ok"])
})
