// LLM router: free hosted models first, with automatic failover and an audit trail.
//   LLM_PROVIDERS=groq,gemini,ollama   order to try (default; unconfigured ones are skipped)
//   GROQ_API_KEY / GROQ_MODEL          console.groq.com
//   GEMINI_API_KEY / GEMINI_MODEL      aistudio.google.com
//   LLM_REASONING_EFFORT               low (default) | medium | high | off. The default models
//                                      think before answering; low keeps that from using up max_tokens.
// Groq and Gemini both speak the OpenAI chat-completions format. When one answers 429
// (rate limit or daily quota), 401/403 (key), 404 (model) or 5xx, the router writes an
// llm_calls row with a cooldown and moves to the next provider. Cooldowns are read back
// from llm_calls, so a quota that ran out stays skipped across runs until it resets.
import { and, desc, eq, gt, isNotNull, notInArray, or, isNull } from "drizzle-orm"
import { ollamaStructured } from "../agent/ollama"

export type ProviderName = "groq" | "gemini" | "ollama"
export type ProviderCfg = { name: ProviderName; model: string; kind: "openai" | "ollama"; baseUrl: string; apiKey?: string; reasoningEffort?: string }
type Env = Record<string, string | undefined>

export const PROVIDER_DEFAULTS: Record<ProviderName, { baseUrl: string; model: string }> = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.5-flash-lite" },
  ollama: { baseUrl: "http://localhost:11434", model: "qwen3:4b" },
}

export function providersFromEnv(env: Env = process.env): ProviderCfg[] {
  const order = (env.LLM_PROVIDERS || "groq,gemini,ollama").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  const out: ProviderCfg[] = []
  const effort = (env.LLM_REASONING_EFFORT?.trim() || "low").toLowerCase()
  const reasoningEffort = effort === "off" ? undefined : effort
  for (const name of order) {
    if (name === "groq" && env.GROQ_API_KEY?.trim()) out.push({ name, kind: "openai", baseUrl: PROVIDER_DEFAULTS.groq.baseUrl, model: env.GROQ_MODEL?.trim() || PROVIDER_DEFAULTS.groq.model, apiKey: env.GROQ_API_KEY.trim(), reasoningEffort })
    if (name === "gemini" && env.GEMINI_API_KEY?.trim()) out.push({ name, kind: "openai", baseUrl: PROVIDER_DEFAULTS.gemini.baseUrl, model: env.GEMINI_MODEL?.trim() || PROVIDER_DEFAULTS.gemini.model, apiKey: env.GEMINI_API_KEY.trim(), reasoningEffort })
    if (name === "ollama") out.push({ name, kind: "ollama", baseUrl: (env.OLLAMA_URL || PROVIDER_DEFAULTS.ollama.baseUrl).replace(/\/+$/, ""), model: env.OLLAMA_MODEL?.trim() || PROVIDER_DEFAULTS.ollama.model })
  }
  return out
}

// ── Failure classification ──────────────────────────────────────────────────
export type CallStatus = "ok" | "rate_limited" | "quota_exhausted" | "error" | "invalid_output"
// retryFrom: where the pause length came from. "provider" = the reply said when to retry
// (retry-after header, "try again in 15.5s", "Please retry in 19h46m", Gemini's retryDelay);
// "estimated" = the reply gave no time, so the router picked one (and says so in the message).
export type Failure = { status: Exclude<CallStatus, "ok">; cooldownMs: number; message: string; retryFrom?: "provider" | "estimated" }

/** Milliseconds until the next midnight in US Pacific time (when Gemini's daily quota resets). */
export function msUntilPacificMidnight(now: Date): number {
  const pt = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }))
  const next = new Date(pt)
  next.setHours(24, 0, 0, 0)
  return Math.max(60_000, next.getTime() - pt.getTime())
}

export function classifyFailure(httpStatus: number | null, body: string, retryAfter: string | null, now: Date): Failure {
  const msg = body.replace(/\s+/g, " ").slice(0, 300)
  // The provider's own retry time, in the forms the replies use: a retry-after header (seconds),
  // Groq's "Please try again in 15.552s", Gemini's "Please retry in 19h46m2.9s" and its
  // RetryInfo "retryDelay": "52s".
  const retryMs = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter) ? Math.ceil(Number(retryAfter) * 1000)
    : parseResetMs(/(?:retry|try again) in ((?:[\d.]+(?:ms|h|m|s))+)/i.exec(body)?.[1] ?? null)
      ?? parseResetMs(/"retryDelay"\s*:\s*"([\d.]+s)"/.exec(body)?.[1] ?? null)
  if (httpStatus === 429) {
    const daily = /per ?day|daily|PerDay|RESOURCE_EXHAUSTED.*day|tokens per day|requests per day|\bRPD\b|\bTPD\b/i.test(body)
    // Use the reply's time even when it's short: Groq's daily token limit is a rolling window, so
    // "try again in 15s" is right, and resting until midnight would bench it for hours for nothing.
    if (daily) {
      return retryMs != null
        ? { status: "quota_exhausted", cooldownMs: retryMs, message: `daily quota used up (retry time from the reply): ${msg}`, retryFrom: "provider" }
        : { status: "quota_exhausted", cooldownMs: msUntilPacificMidnight(now), message: `daily quota used up (the reply gave no retry time; estimated midnight US Pacific): ${msg}`, retryFrom: "estimated" }
    }
    return retryMs != null
      ? { status: "rate_limited", cooldownMs: retryMs, message: `rate limited: ${msg}`, retryFrom: "provider" }
      : { status: "rate_limited", cooldownMs: 60_000, message: `rate limited (the reply gave no retry time; estimated 60 s): ${msg}`, retryFrom: "estimated" }
  }
  if (httpStatus === 401 || httpStatus === 403) return { status: "error", cooldownMs: 60 * 60_000, message: `key rejected (HTTP ${httpStatus}) - check the API key: ${msg}` }
  if (httpStatus === 404) return { status: "error", cooldownMs: 60 * 60_000, message: `model not found (HTTP 404) - set the *_MODEL variable to a current model: ${msg}` }
  // 400 is about this request (e.g. Groq's json_validate_failed), not the provider: try the next one, no rest.
  if (httpStatus === 400) return { status: "invalid_output", cooldownMs: 0, message: `request rejected (HTTP 400): ${msg}` }
  if (httpStatus && httpStatus >= 500) return { status: "error", cooldownMs: 30_000, message: `provider error HTTP ${httpStatus}: ${msg}` }
  if (httpStatus) return { status: "error", cooldownMs: 5 * 60_000, message: `HTTP ${httpStatus}: ${msg}` }
  return { status: "error", cooldownMs: 30_000, message: `request failed: ${msg}` }
}

// ── Audit ───────────────────────────────────────────────────────────────────
export type AuditRow = {
  id: string; at: string; purpose: string; subjectRef: string | null; provider: ProviderName; model: string; status: CallStatus
  httpStatus: number | null; latencyMs: number | null; inputTokens: number | null; outputTokens: number | null
  error: string | null; cooldownUntil: string | null; fallbackFrom: string | null
}
export type AuditSink = { write(row: AuditRow): Promise<void>; activeCooldowns(now: Date, models?: Partial<Record<ProviderName, string>>): Promise<Map<ProviderName, string>> }

export const dbAuditSink: AuditSink = {
  async write(row) {
    const { db } = await import("../db")
    const { llmCalls } = await import("../db/schema")
    await db.insert(llmCalls).values(row)
  },
  async activeCooldowns(now, models) {
    const { db } = await import("../db")
    const { llmCalls } = await import("../db/schema")
    // Only limits and outages carry over between runs. A bad key (401/403) or model (404)
    // is fixed by changing .env.local, so it mustn't keep the provider benched afterwards.
    // Quotas are per model, so a rest earned by another model (before a *_MODEL change) is ignored.
    const rows = await db.select({ provider: llmCalls.provider, model: llmCalls.model, until: llmCalls.cooldownUntil }).from(llmCalls)
      .where(and(
        isNotNull(llmCalls.cooldownUntil), gt(llmCalls.cooldownUntil, now.toISOString()),
        or(isNull(llmCalls.httpStatus), notInArray(llmCalls.httpStatus, [401, 403, 404])),
      )).orderBy(desc(llmCalls.at)).limit(50)
    const m = new Map<ProviderName, string>()
    for (const r of rows) {
      const p = r.provider as ProviderName
      if (r.until && !m.has(p) && (!models?.[p] || models[p] === r.model)) m.set(p, r.until)
    }
    // A later successful call clears a cooldown (e.g. a per-minute limit that already passed).
    for (const p of [...m.keys()]) {
      const ok = await db.select({ at: llmCalls.at }).from(llmCalls).where(and(eq(llmCalls.provider, p), eq(llmCalls.status, "ok"))).orderBy(desc(llmCalls.at)).limit(1)
      const lastFail = await db.select({ at: llmCalls.at }).from(llmCalls).where(and(eq(llmCalls.provider, p), isNotNull(llmCalls.cooldownUntil))).orderBy(desc(llmCalls.at)).limit(1)
      if (ok[0] && lastFail[0] && ok[0].at > lastFail[0].at) m.delete(p)
    }
    return m
  },
}

// ── Calls ───────────────────────────────────────────────────────────────────
type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>

export type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: OpenAiToolCall[]; tool_call_id?: string; name?: string }
export type OpenAiToolCall = { id: string; type: "function"; function: { name: string; arguments: string } }
export type OpenAiTool = { type: "function"; function: { name: string; description: string; parameters: unknown } }

export class AllProvidersUnavailable extends Error {
  constructor(message: string, public readonly nextAvailableAt: string | null) {
    super(message)
    this.name = "AllProvidersUnavailable"
  }
}

/** Groq's x-ratelimit-reset-* durations ("7.66s", "2m59.56s", "292.5ms") in ms. */
export function parseResetMs(v: string | null): number | null {
  if (!v) return null
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const
  let ms = 0
  let matched = false
  for (const [, n, u] of v.matchAll(/([\d.]+)(ms|h|m|s)/g)) { matched = true; ms += Number(n) * unit[u as keyof typeof unit] }
  return matched ? Math.ceil(ms) : null
}

type Budget = { tokens: number | null; tokenLimit: number | null; tokensResetAt: number; requests: number | null; requestsResetAt: number }
const PACE_MAX_MS = 20_000
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const newId = () => `llm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export class LlmRouter {
  private cooldowns = new Map<ProviderName, string>()
  private budgets = new Map<ProviderName, Budget>()
  private loaded = false
  constructor(
    private readonly providers: ProviderCfg[],
    private readonly opts: { sink?: AuditSink; fetcher?: Fetcher; now?: () => Date; timeoutMs?: number; ignoreCooldowns?: boolean; sleep?: (ms: number) => Promise<void> } = {},
  ) {}

  get configured() { return this.providers.map((p) => `${p.name}/${p.model}`) }

  private now() { return this.opts.now?.() ?? new Date() }
  private sink() { return this.opts.sink ?? dbAuditSink }

  private async loadCooldowns() {
    if (this.loaded) return
    this.loaded = true
    if (this.opts.ignoreCooldowns) return
    try {
      const models = Object.fromEntries(this.providers.map((p) => [p.name, p.model]))
      for (const [p, until] of await this.sink().activeCooldowns(this.now(), models)) this.cooldowns.set(p, until)
    } catch { /* audit table unreachable: start fresh rather than fail */ }
  }

  private resting(p: ProviderCfg): string | null {
    const until = this.cooldowns.get(p.name)
    return until && until > this.now().toISOString() ? until : null
  }

  // Free tiers cap tokens per minute (Groq: 8,000 on gpt-oss-120b) and report what's left in
  // x-ratelimit-* headers. Wait for the window to refill instead of sending a request that
  // would get a 429. Longer waits (a daily request cap) are left to the normal 429 handling.
  private noteBudget(p: ProviderCfg, h: { get(n: string): string | null }) {
    const num = (n: string) => { const v = h.get(n); return v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null }
    const tokens = num("x-ratelimit-remaining-tokens")
    const tokenLimit = num("x-ratelimit-limit-tokens")
    const requests = num("x-ratelimit-remaining-requests")
    if (tokens == null && requests == null) return
    const now = this.now().getTime()
    this.budgets.set(p.name, {
      tokens, tokenLimit, tokensResetAt: now + (parseResetMs(h.get("x-ratelimit-reset-tokens")) ?? 0),
      requests, requestsResetAt: now + (parseResetMs(h.get("x-ratelimit-reset-requests")) ?? 0),
    })
  }

  private async pace(p: ProviderCfg, estTokens: number) {
    const b = this.budgets.get(p.name)
    if (!b) return
    const now = this.now().getTime()
    let until = 0
    if (b.tokens != null && b.tokens < estTokens && b.tokensResetAt > now) {
      // reset-tokens is when the whole window is full again; tokens come back steadily, so
      // wait only for the share this request is missing (what Groq's "try again in" says).
      const full = b.tokensResetAt - now
      const share = b.tokenLimit && b.tokenLimit > b.tokens ? Math.min(1, (estTokens - b.tokens) / (b.tokenLimit - b.tokens)) : 1
      until = now + Math.ceil(full * share)
    }
    if (b.requests != null && b.requests < 1 && b.requestsResetAt > now) until = Math.max(until, b.requestsResetAt)
    const wait = until - now
    if (wait > 0 && wait <= PACE_MAX_MS) {
      await (this.opts.sleep ?? sleep)(wait + 50)
      this.budgets.delete(p.name)
    }
  }

  private async audit(row: Omit<AuditRow, "id" | "at">) {
    try { await this.sink().write({ id: newId(), at: this.now().toISOString(), ...row }) } catch { /* never fail a call because the audit write failed */ }
  }

  /**
   * One chat call with failover. `parse` turns the reply into the value the caller wants
   * and throws if it's unusable (then the next provider is tried and the reply is audited
   * as invalid_output). Providers that can't do tools are skipped when tools are passed.
   */
  async call<T>(req: {
    purpose: string; subjectRef?: string | null; messages: ChatMessage[]; tools?: OpenAiTool[]
    json?: boolean; schema?: object; maxTokens?: number; parse: (msg: { content: string | null; tool_calls?: OpenAiToolCall[] }) => T
  }): Promise<{ value: T; provider: ProviderName; model: string; message: { content: string | null; tool_calls?: OpenAiToolCall[] } }> {
    await this.loadCooldowns()
    const skipped: string[] = []
    for (const p of this.providers) {
      if (req.tools && p.kind !== "openai") continue
      const until = this.resting(p)
      if (until) { skipped.push(`${p.name} (resting until ${until})`); continue }
      const started = Date.now()
      const base = { purpose: req.purpose, subjectRef: req.subjectRef ?? null, provider: p.name, model: p.model, fallbackFrom: skipped.length ? skipped.join("; ") : null }
      let message: { content: string | null; tool_calls?: OpenAiToolCall[] }
      let usage = { input: null as number | null, output: null as number | null }
      try {
        if (p.kind === "ollama") {
          if (!req.schema) throw Object.assign(new Error("ollama is used for structured calls only"), { skip: true })
          const r = await ollamaStructured<unknown>({
            baseUrl: p.baseUrl, model: p.model, schema: req.schema, maxTokens: req.maxTokens ?? 160, timeoutMs: this.opts.timeoutMs ?? 180_000,
            system: req.messages.find((m) => m.role === "system")?.content ?? "", user: req.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n"),
          })
          message = { content: JSON.stringify(r.value) }
          usage = { input: r.promptTokens, output: r.evalTokens }
        } else {
          // Rough token estimate (4 chars a token) plus room for the reply.
          await this.pace(p, Math.ceil(JSON.stringify(req.messages).length / 4) + 200)
          const r = await this.openAi(p, req)
          if (!r.ok) {
            const f = classifyFailure(r.status, r.body, r.retryAfter, this.now())
            const until = f.cooldownMs > 0 ? new Date(this.now().getTime() + f.cooldownMs).toISOString() : null
            if (until) this.cooldowns.set(p.name, until)
            await this.audit({ ...base, status: f.status, httpStatus: r.status, latencyMs: Date.now() - started, inputTokens: null, outputTokens: null, error: f.message, cooldownUntil: until })
            skipped.push(`${p.name} (${f.status}: ${f.message.slice(0, 90)})`)
            continue
          }
          message = r.message
          usage = r.usage
        }
      } catch (e) {
        if ((e as { skip?: boolean }).skip) continue
        const f = classifyFailure(null, (e as Error).message, null, this.now())
        const until = new Date(this.now().getTime() + f.cooldownMs).toISOString()
        this.cooldowns.set(p.name, until)
        await this.audit({ ...base, status: "error", httpStatus: null, latencyMs: Date.now() - started, inputTokens: null, outputTokens: null, error: f.message, cooldownUntil: until })
        skipped.push(`${p.name} (error: ${f.message.slice(0, 90)})`)
        continue
      }
      let value: T
      try {
        value = req.parse(message)
      } catch (e) {
        await this.audit({ ...base, status: "invalid_output", httpStatus: 200, latencyMs: Date.now() - started, inputTokens: usage.input, outputTokens: usage.output, error: (e as Error).message.slice(0, 300), cooldownUntil: null })
        skipped.push(`${p.name} (invalid output)`)
        continue
      }
      this.cooldowns.delete(p.name)
      await this.audit({ ...base, status: "ok", httpStatus: 200, latencyMs: Date.now() - started, inputTokens: usage.input, outputTokens: usage.output, error: null, cooldownUntil: null })
      return { value, provider: p.name, model: p.model, message }
    }
    const next = [...this.cooldowns.values()].sort()[0] ?? null
    throw new AllProvidersUnavailable(
      this.providers.length
        ? `no LLM provider available: ${skipped.join("; ") || "none can handle this request"}`
        : "no LLM provider configured - set GROQ_API_KEY and/or GEMINI_API_KEY (or LLM_PROVIDERS=ollama)",
      next,
    )
  }

  private async openAi(p: ProviderCfg, req: { messages: ChatMessage[]; tools?: OpenAiTool[]; json?: boolean; maxTokens?: number }) {
    const fetcher: Fetcher = this.opts.fetcher ?? ((u, i) => fetch(u, i) as never)
    const body: Record<string, unknown> = { model: p.model, messages: req.messages, temperature: 0, max_tokens: req.maxTokens ?? 1024 }
    if (p.reasoningEffort) body.reasoning_effort = p.reasoningEffort
    if (req.tools?.length) body.tools = req.tools
    if (req.json) body.response_format = { type: "json_object" }
    const res = await fetcher(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60_000),
    })
    this.noteBudget(p, res.headers)
    const text = await res.text()
    if (!res.ok) return { ok: false as const, status: res.status, body: text, retryAfter: res.headers.get("retry-after") }
    const j = JSON.parse(text)
    const m = j.choices?.[0]?.message ?? {}
    return {
      ok: true as const,
      message: { content: m.content ?? null, tool_calls: m.tool_calls?.length ? m.tool_calls : undefined },
      usage: { input: j.usage?.prompt_tokens ?? null, output: j.usage?.completion_tokens ?? null },
    }
  }
}

let shared: LlmRouter | null = null
/** One router per process, so cooldowns learned in one call apply to the next. */
export function defaultRouter(): LlmRouter {
  shared ??= new LlmRouter(providersFromEnv())
  return shared
}
