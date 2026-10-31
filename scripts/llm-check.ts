// Check each configured LLM provider with one tiny call (logged on the AI usage page).
//   npm run llm-check
// Prints, per provider: ok + latency, or the reason it failed (bad key, wrong model,
// rate limited, daily quota used up). Never prints keys.
import { LlmRouter, providersFromEnv } from "../lib/llm/router"

async function main() {
  const all = providersFromEnv()
  if (!all.length) {
    console.log("No provider configured. Set GROQ_API_KEY and/or GEMINI_API_KEY in .env.local (see .env.example).")
    process.exitCode = 1
    return
  }
  let failed = 0
  for (const p of all) {
    // One router per provider so each is tested on its own, with no failover.
    // ignoreCooldowns: a check always tries the provider, even if it was resting.
    const router = new LlmRouter([p], { timeoutMs: 60_000, ignoreCooldowns: true })
    const started = Date.now()
    try {
      const r = await router.call({
        // The entity check's budget: models that think first (Gemini 3.1-lite) run out of 60 tokens
        // before writing the JSON, which looked like a broken model when it wasn't.
        purpose: "llm_check", json: true, maxTokens: 800,
        schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
        messages: [{ role: "system", content: 'Reply with JSON only: {"ok": true}' }, { role: "user", content: "ping" }],
        parse: (m) => {
          const v = JSON.parse((m.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, ""))
          if (v?.ok !== true) throw new Error(`unexpected reply: ${(m.content ?? "").slice(0, 60)}`)
          return v
        },
      })
      console.log(`✓ ${p.name.padEnd(7)} ${r.model.padEnd(28)} ${((Date.now() - started) / 1000).toFixed(1)} s`)
    } catch (e) {
      failed++
      console.log(`✗ ${p.name.padEnd(7)} ${p.model.padEnd(28)} ${(e as Error).message.slice(0, 220)}`)
    }
  }
  console.log(`\n${all.length - failed}/${all.length} providers working. Order used: ${all.map((p) => p.name).join(" → ")}`)
  if (failed === all.length) process.exitCode = 1
}

main()
