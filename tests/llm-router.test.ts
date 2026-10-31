import { test } from "node:test"
import assert from "node:assert/strict"
import { AllProvidersUnavailable, LlmRouter, classifyFailure, msUntilPacificMidnight, parseResetMs, providersFromEnv, slotOf, type AuditRow, type AuditSink, type ProviderCfg } from "../lib/llm/router"

const NOW = new Date("2026-10-29T12:00:00Z")
const memorySink = (rows: AuditRow[] = []): AuditSink & { rows: AuditRow[] } => ({
  rows,
  async write(r) { rows.push(r) },
  async activeCooldowns(now) {
    const m = new Map()
    for (const r of [...rows].reverse()) if (r.cooldownUntil && r.cooldownUntil > now.toISOString() && !m.has(slotOf(r))) m.set(slotOf(r), r.cooldownUntil)
    return m
  },
})
const groq: ProviderCfg = { name: "groq", kind: "openai", baseUrl: "https://groq.test/v1", model: "g-model", apiKey: "TEST_KEY_G" }
const gemini: ProviderCfg = { name: "gemini", kind: "openai", baseUrl: "https://gemini.test/v1", model: "m-model", apiKey: "TEST_KEY_M" }

type Reply = { status: number; body: unknown; retryAfter?: string }
const fakeFetch = (replies: Record<string, Reply[]>, seen: string[] = []) => async (url: string, init: { headers: Record<string, string>; body: string }) => {
  const host = new URL(url).host
  seen.push(host)
  assert.match(init.headers.authorization, /^Bearer TEST_KEY_/)
  const r = replies[host]?.shift() ?? { status: 500, body: { error: "no reply scripted" } }
  return { ok: r.status === 200, status: r.status, headers: { get: (n: string) => (n === "retry-after" ? r.retryAfter ?? null : null) }, text: async () => JSON.stringify(r.body) }
}
const okReply = (content: string): Reply => ({ status: 200, body: { choices: [{ message: { content } }], usage: { prompt_tokens: 50, completion_tokens: 10 } } })
const req = { purpose: "entity_check", subjectRef: "UC1", json: true, messages: [{ role: "user" as const, content: "hi" }], parse: (m: { content: string | null }) => JSON.parse(m.content ?? "") }

test("providers come from env in order, and unconfigured ones are skipped", () => {
  // By default Groq and Gemini each bring two models, each with its own free quota.
  assert.deepEqual(providersFromEnv({ GROQ_API_KEY: "a", GEMINI_API_KEY: "b" }).map(slotOf), ["groq/openai/gpt-oss-120b", "groq/openai/gpt-oss-20b", "gemini/gemini-3.5-flash-lite", "gemini/gemini-3.1-flash-lite", "ollama/qwen3:4b"])
  assert.deepEqual(providersFromEnv({ GEMINI_API_KEY: "b", LLM_PROVIDERS: "gemini,groq", GEMINI_MODEL: "gemini-3.1-flash-lite" }).map(slotOf), ["gemini/gemini-3.1-flash-lite"])
  assert.deepEqual(providersFromEnv({ GROQ_API_KEY: "a", GROQ_MODEL: " m1 , m2 ,", LLM_PROVIDERS: "groq" }).map((p) => p.model), ["m1", "m2"])
  assert.equal(providersFromEnv({ GROQ_API_KEY: "a", GROQ_MODEL: "llama-x", LLM_PROVIDERS: "groq" })[0].model, "llama-x")
  // Reasoning models: low effort by default so thinking doesn't use up max_tokens; "off" sends nothing.
  assert.equal(providersFromEnv({ GROQ_API_KEY: "a", LLM_PROVIDERS: "groq" })[0].reasoningEffort, "low")
  assert.equal(providersFromEnv({ GROQ_API_KEY: "a", LLM_PROVIDERS: "groq", LLM_REASONING_EFFORT: "off" })[0].reasoningEffort, undefined)
})

test("OpenRouter joins after Groq and Gemini, gets no reasoning_effort, and sends its fallback list", async () => {
  const all = { GROQ_API_KEY: "a", GEMINI_API_KEY: "b", OPENROUTER_API_KEY: "TEST_KEY_E" }
  const ps = providersFromEnv(all)
  assert.deepEqual([...new Set(ps.map((p) => `${p.name}:${p.reasoningEffort ?? "-"}`))], ["groq:low", "gemini:low", "openrouter:-", "ollama:-"])
  assert.equal(ps.filter((p) => p.name === "openrouter").length, 1) // its list goes in one request
  const or = ps.find((p) => p.name === "openrouter")!
  assert.equal(or.baseUrl, "https://openrouter.ai/api/v1")
  assert.match(or.model, /^[^,]+:free(,[^,]+:free)+$/)
  assert.equal(providersFromEnv({ ...all, OPENROUTER_MODEL: "x/one:free", LLM_PROVIDERS: "openrouter" })[0].model, "x/one:free")
  // An old LLM_PROVIDERS without openrouter leaves it out even when its key is set.
  assert.deepEqual([...new Set(providersFromEnv({ ...all, LLM_PROVIDERS: "groq,gemini,ollama" }).map((p) => p.name))], ["groq", "gemini", "ollama"])
  let body: Record<string, unknown> = {}
  const router = new LlmRouter([or], { sink: memorySink(), now: () => NOW, fetcher: async (_url: string, init: { body: string }) => {
    body = JSON.parse(init.body)
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }) }
  } })
  await router.call(req)
  assert.ok(!("reasoning_effort" in body))
  assert.deepEqual(body.response_format, { type: "json_object" })
  assert.ok(Array.isArray(body.models) && (body.models as string[]).length >= 2)
  assert.equal(body.model, (body.models as string[])[0])
})

test("failures are classified: daily quota rests until the reset, per-minute limits use retry-after", () => {
  // OpenRouter's daily cap for free models says "free-models-per-day".
  assert.equal(classifyFailure(429, '{"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day","code":429}}', null, NOW).status, "quota_exhausted")
  const daily = classifyFailure(429, '{"error":{"message":"Rate limit reached for model in organization on tokens per day (TPD)"}}', null, NOW)
  assert.equal(daily.status, "quota_exhausted")
  assert.equal(daily.cooldownMs, msUntilPacificMidnight(NOW))
  const gem = classifyFailure(429, '{"error":{"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded for metric generate_content_free_tier_requests, limit PerDay"}}', null, NOW)
  assert.equal(gem.status, "quota_exhausted")
  assert.deepEqual(classifyFailure(429, "Rate limit reached: requests per minute", "7", NOW), { status: "rate_limited", cooldownMs: 7000, message: "rate limited: Rate limit reached: requests per minute", retryFrom: "provider" })
  // The provider's own retry time wins over the router's guess, even for a daily limit. This is
  // Groq's real reply on 2026-10-30: a rolling tokens-per-day window, free again in 15.552 s.
  const groqTpd = classifyFailure(429, '{"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` on tokens per day (TPD): Limit 200000, Used 199455, Requested 581. Please try again in 15.552s."}}', null, NOW)
  assert.deepEqual([groqTpd.status, groqTpd.cooldownMs, groqTpd.retryFrom], ["quota_exhausted", 15_552, "provider"])
  // Gemini's RetryInfo detail.
  assert.equal(classifyFailure(429, '{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"52s"}]}}', null, NOW).cooldownMs, 52_000)
  // No time in the reply: the router's estimate, labelled as one.
  const guess = classifyFailure(429, "too many requests", null, NOW)
  assert.equal(guess.retryFrom, "estimated")
  assert.match(guess.message, /gave no retry time; estimated 60 s/)
  assert.equal(classifyFailure(401, "invalid api key", null, NOW).status, "error")
  assert.match(classifyFailure(404, "model not found", null, NOW).message, /set the \*_MODEL variable/)
  // Gemini sends no retry-after header; its body says how long to wait.
  assert.equal(classifyFailure(429, '{"error":{"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 5 per minute. Please retry in 12.3s.","status":"RESOURCE_EXHAUSTED"}}', null, NOW).cooldownMs, 12_300)
  const gemDay = classifyFailure(429, '{"error":{"message":"Generate content requests per day limit exceeded on Free Tier.\nPlease retry in 19h46m2.9s.","status":"RESOURCE_EXHAUSTED"}}', null, NOW)
  assert.equal(gemDay.status, "quota_exhausted")
  assert.equal(gemDay.cooldownMs, 71_162_900)
  // Groq's json_validate_failed is about one request: move on, but don't bench the provider.
  const bad = classifyFailure(400, '{"error":{"code":"json_validate_failed"}}', null, NOW)
  assert.equal(bad.status, "invalid_output")
  assert.equal(bad.cooldownMs, 0)
  // 12:00 UTC on 29 Oct is 05:00 Pacific (PDT): 19 hours to midnight.
  assert.equal(msUntilPacificMidnight(NOW), 19 * 3_600_000)
})

test("when Groq's daily quota runs out, the call switches to Gemini and the audit shows why", async () => {
  const sink = memorySink()
  const seen: string[] = []
  const router = new LlmRouter([groq, gemini], {
    sink, now: () => NOW,
    fetcher: fakeFetch({ "groq.test": [{ status: 429, body: { error: { message: "tokens per day (TPD) limit reached" } } }], "gemini.test": [okReply('{"entity":"individual"}'), okReply('{"entity":"brand"}')] }, seen),
  })
  const a = await router.call(req)
  assert.equal(a.provider, "gemini")
  assert.deepEqual(a.value, { entity: "individual" })
  assert.deepEqual(sink.rows.map((r) => `${r.provider}:${r.status}`), ["groq:quota_exhausted", "gemini:ok"])
  assert.equal(sink.rows[0].cooldownUntil, new Date(NOW.getTime() + msUntilPacificMidnight(NOW)).toISOString())
  assert.match(sink.rows[1].fallbackFrom ?? "", /groq \(quota_exhausted: daily quota used up/)
  assert.deepEqual([sink.rows[1].inputTokens, sink.rows[1].outputTokens], [50, 10])

  // The next call doesn't even try Groq while it rests.
  const b = await router.call(req)
  assert.equal(b.provider, "gemini")
  assert.deepEqual(seen, ["groq.test", "gemini.test", "gemini.test"])
  assert.match(sink.rows[2].fallbackFrom ?? "", /groq \(resting until/)
})

test("a cooldown written by an earlier run is respected by a new router", async () => {
  const sink = memorySink([{ id: "x", at: NOW.toISOString(), purpose: "entity_check", subjectRef: null, provider: "groq", model: "g-model", status: "quota_exhausted", httpStatus: 429, latencyMs: 1, inputTokens: null, outputTokens: null, error: "daily", cooldownUntil: "2026-10-30T07:00:00.000Z", fallbackFrom: null }])
  const seen: string[] = []
  const router = new LlmRouter([groq, gemini], { sink, now: () => NOW, fetcher: fakeFetch({ "gemini.test": [okReply('{"entity":"unsure"}')] }, seen) })
  assert.equal((await router.call(req)).provider, "gemini")
  assert.deepEqual(seen, ["gemini.test"])
})

test("two models of one provider rest separately: a used-up 120b falls through to 20b", async () => {
  const big: ProviderCfg = { ...groq, model: "big" }
  const small: ProviderCfg = { ...groq, model: "small" }
  const sink = memorySink()
  const seen: string[] = []
  const router = new LlmRouter([big, small, gemini], { sink, now: () => NOW, fetcher: async (url: string, init: { body: string }) => {
    const model = JSON.parse(init.body).model
    seen.push(model)
    if (model === "big") return { ok: false, status: 429, headers: { get: () => null }, text: async () => '{"error":{"message":"tokens per day (TPD) limit reached"}}' }
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }) }
  } })
  const r1 = await router.call(req)
  assert.equal(`${r1.provider}/${r1.model}`, "groq/small")
  const r2 = await router.call(req)
  assert.equal(`${r2.provider}/${r2.model}`, "groq/small")
  assert.deepEqual(seen, ["big", "small", "small"]) // big rests after its daily limit; small keeps answering
  // A new router reads the rest back for "big" only.
  const later = new LlmRouter([big, small], { sink, now: () => NOW, fetcher: async (_u: string, init: { body: string }) => { seen.push(JSON.parse(init.body).model); return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }) } } })
  assert.equal((await later.call(req)).model, "small")
})

test("unusable output is audited and the next provider is tried", async () => {
  const sink = memorySink()
  const router = new LlmRouter([groq, gemini], { sink, now: () => NOW, fetcher: fakeFetch({ "groq.test": [okReply("not json")], "gemini.test": [okReply('{"entity":"agency"}')] }) })
  const r = await router.call(req)
  assert.equal(r.provider, "gemini")
  assert.deepEqual(sink.rows.map((x) => x.status), ["invalid_output", "ok"])
})

test("when every provider is out, the caller learns when the first one is back", async () => {
  const sink = memorySink()
  const router = new LlmRouter([groq, gemini], {
    sink, now: () => NOW,
    fetcher: fakeFetch({ "groq.test": [{ status: 429, body: "slow down", retryAfter: "30" }], "gemini.test": [{ status: 429, body: { error: { message: "Quota exceeded ... PerDay" } } }] }),
  })
  await assert.rejects(router.call(req), (e: unknown) => {
    assert.ok(e instanceof AllProvidersUnavailable)
    assert.equal(e.nextAvailableAt, new Date(NOW.getTime() + 30_000).toISOString()) // Groq's per-minute limit ends first
    assert.match(e.message, /groq \(rate_limited: .*gemini \(quota_exhausted: /)
    return true
  })
  await assert.rejects(new LlmRouter([], { sink, now: () => NOW }).call(req), /no LLM provider configured/)
})

test("tool calls only go to providers that support them", async () => {
  const sink = memorySink()
  const ollama: ProviderCfg = { name: "ollama", kind: "ollama", baseUrl: "http://localhost:1", model: "q" }
  const router = new LlmRouter([ollama, groq], { sink, now: () => NOW, fetcher: fakeFetch({ "groq.test": [{ status: 200, body: { choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "list_qualified_leads", arguments: "{}" } }] } }] } }] }) })
  const r = await router.call({ purpose: "agent", messages: [{ role: "user", content: "go" }], tools: [{ type: "function", function: { name: "list_qualified_leads", description: "", parameters: {} } }], parse: (m) => m })
  assert.equal(r.provider, "groq")
  assert.equal(r.message.tool_calls?.[0].function.name, "list_qualified_leads")
  assert.deepEqual(sink.rows.map((x) => x.provider), ["groq"]) // ollama never called
})

test("Groq's rate-limit headers pace the next call instead of earning a 429", async () => {
  assert.equal(parseResetMs("7.66s"), 7660)
  assert.equal(parseResetMs("2m59.56s"), 179_560)
  assert.equal(parseResetMs("292.5ms"), 293)
  assert.equal(parseResetMs(null), null)

  const headers: Record<string, string>[] = [
    { "x-ratelimit-remaining-tokens": "120", "x-ratelimit-reset-tokens": "1.5s", "x-ratelimit-remaining-requests": "900" },
    { "x-ratelimit-remaining-tokens": "7800", "x-ratelimit-reset-tokens": "0.2s", "x-ratelimit-remaining-requests": "899" },
    { "x-ratelimit-remaining-tokens": "10", "x-ratelimit-reset-tokens": "45s" },
    // Groq's real shape: reset-tokens is the time to refill the whole 8,000, so wait only for
    // the share this request needs: (est 205 - 0) / (8000 - 0) of 28 s ≈ 0.72 s.
    { "x-ratelimit-limit-tokens": "8000", "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "28s" },
  ]
  const slept: number[] = []
  const router = new LlmRouter([groq], {
    sink: memorySink(), now: () => NOW, sleep: async (ms) => { slept.push(ms) },
    fetcher: async () => {
      const h = headers.shift() ?? {}
      return { ok: true, status: 200, headers: { get: (n: string) => h[n] ?? null }, text: async () => JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }) }
    },
  })
  await router.call(req) // leaves 120 tokens: too few for the next request
  await router.call(req) // so this one waits for the 1.5 s refill first
  assert.deepEqual(slept, [1550])
  await router.call(req) // plenty left: no wait
  await router.call(req) // 10 left but the refill is 45 s away: send and let 429 handling decide
  assert.deepEqual(slept, [1550])
  await router.call(req) // (the reply carried the 28 s / 8,000-limit headers)
  await router.call(req)
  assert.equal(slept.length, 2)
  assert.ok(slept[1] > 500 && slept[1] < 1500, `waited ${slept[1]} ms`)
})
