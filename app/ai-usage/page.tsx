import { db } from "@/lib/db"
import { llmCalls, type LlmCall } from "@/lib/db/schema"
import { desc, gt, isNotNull, and } from "drizzle-orm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PROVIDER_DEFAULTS, providersFromEnv, type ProviderName } from "@/lib/llm/router"
import { probeOllama } from "@/lib/llm/probe"
import { ArrowRight, CheckCircle2, AlertTriangle, XCircle } from "lucide-react"

export const dynamic = "force-dynamic"

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })

function ago(iso: string, now: Date) {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return when(iso)
}

const TASK: Record<string, string> = { entity_check: "Entity check", agent: "AI agent", llm_check: "Connection test" }

// Plain-language reason for a failed call. The raw provider message stays in the tooltip.
function reason(status: string, httpStatus: number | null, error: string | null): string {
  const e = error ?? ""
  if (status === "rate_limited") return "Rate limit"
  if (status === "quota_exhausted") return "Daily quota used up"
  if (status === "invalid_output") return "Wrong answer format"
  if (/not reachable|ECONNREFUSED/i.test(e)) return "Not running"
  if (httpStatus === 401 || httpStatus === 403) return "API key rejected"
  if (httpStatus === 404) return "Model not found"
  if (httpStatus && httpStatus >= 500) return "Provider outage"
  if (/timeout|timed out|abort/i.test(e)) return "Timed out"
  return "Request failed"
}

// fallbackFrom is "groq (rate_limited: …); gemini (resting until …)": the providers tried first and why they didn't answer.
function skippedReasons(fallbackFrom: string): { provider: string; why: string }[] {
  return fallbackFrom.split("; ").map((part) => {
    const m = part.match(/^(\w+) \((\w+)/)
    const provider = m?.[1] ?? part
    const tag = m?.[2] ?? ""
    const why = tag === "resting" ? "Paused after a limit" : reason(tag, null, part)
    return { provider, why }
  })
}

const countBy = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])

const FIX: Record<string, string> = {
  "Not running": "Start it with: docker compose up -d ollama",
  "API key rejected": "Check the API key in .env.local",
  "Model not found": "Set the *_MODEL variable to a current model",
  "Daily quota used up": "Resets at midnight Pacific time",
}

type State = { label: string; tone: "success" | "warn" | "danger" | "secondary"; usable: boolean; detail?: string }

export default async function AiUsagePage() {
  const now = new Date()
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString()
  const [recent, day, resting] = await Promise.all([
    db.select().from(llmCalls).orderBy(desc(llmCalls.at)).limit(30),
    db.select().from(llmCalls).where(gt(llmCalls.at, since)),
    db.select().from(llmCalls).where(and(isNotNull(llmCalls.cooldownUntil), gt(llmCalls.cooldownUntil, now.toISOString()))).orderBy(desc(llmCalls.at)),
  ])
  const configured = providersFromEnv()
  const ollamaCfg = configured.find((p) => p.name === "ollama")
  const ollamaProbe = ollamaCfg ? await probeOllama(ollamaCfg.baseUrl, ollamaCfg.model) : null
  const order = configured.map((p) => p.name)
  const names: ProviderName[] = [...order, ...(["groq", "gemini", "ollama"] as ProviderName[]).filter((n) => !order.includes(n))]

  const providers = names.map((name) => {
    const cfg = configured.find((p) => p.name === name)
    const rows = day.filter((c) => c.provider === name)
    const lastOk = rows.filter((c) => c.status === "ok").sort((a, b) => b.at.localeCompare(a.at))[0]
    const rest = resting.find((c) => c.provider === name)
    // A success after the cooldown was set means the provider is back.
    const restingUntil = rest && !(lastOk && lastOk.at > rest.at) ? rest.cooldownUntil : null
    const ok = rows.filter((c) => c.status === "ok")
    const failures = rows.filter((c) => c.status !== "ok")
    const last = rows.reduce<LlmCall | undefined>((a, c) => (!a || c.at > a.at ? c : a), undefined)
    const probe = name === "ollama" ? ollamaProbe : null

    const state: State = !cfg ? { label: "Not set up", tone: "secondary", usable: false }
      : probe?.state === "down" ? { label: "Not running", tone: "danger", usable: false, detail: probe.detail }
      : probe?.state === "no_model" ? { label: "Model missing", tone: "danger", usable: false, detail: probe.detail }
      : restingUntil ? {
        label: `Paused until ${hhmm(restingUntil)}`, tone: "warn", usable: false,
        // Say where the time came from: the provider's own reply, or the router's estimate when the
        // reply gave none (marked in the stored error since 2026-10-30).
        detail: /gave no retry time/.test(rest?.error ?? "")
          ? `It hit a limit. ${cfg.name} didn't say when to retry, so this time is an estimate; calls go to the next provider until then.`
          : `It hit a limit. ${cfg.name[0].toUpperCase() + cfg.name.slice(1)} said to retry at this time; calls go to the next provider until then.`,
      }
      : { label: "Ready", tone: "success", usable: true }

    const lastFailure = failures.reduce<LlmCall | undefined>((a, c) => (!a || c.at > a.at ? c : a), undefined)
    const lastReason = lastFailure ? reason(lastFailure.status, lastFailure.httpStatus, lastFailure.error) : null
    return {
      name, cfg, state, last,
      role: cfg ? (order.indexOf(name) === 0 ? "Primary" : `Backup ${order.indexOf(name)}`) : "Off",
      calls: rows.length, ok: ok.length, failed: failures.length,
      avgMs: ok.length ? Math.round(ok.reduce((s, c) => s + (c.latencyMs ?? 0), 0) / ok.length) : null,
      topProblems: countBy(failures.map((c) => reason(c.status, c.httpStatus, c.error))).slice(0, 2),
      lastFailure, fix: lastReason && !state.usable ? FIX[lastReason] : undefined,
    }
  })

  const active = providers.filter((p) => p.cfg)
  const answering = active.find((p) => p.state.usable)
  const primary = active[0]
  const answered = day.filter((c) => c.status === "ok")
  const switches = answered.filter((c) => c.fallbackFrom)
  const failedAttempts = day.length - answered.length
  const tokens = answered.reduce((s, c) => s + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0)

  const health = !primary ? { tone: "danger" as const, title: "No AI provider set up", text: "Add GROQ_API_KEY and/or GEMINI_API_KEY to .env.local." }
    : !answering ? { tone: "danger" as const, title: "No provider can answer right now", text: "Every configured provider is paused or down. AI calls will fail until one recovers." }
    : answering === primary ? { tone: "success" as const, title: `Healthy: ${primary.name} is answering`, text: active.length > 1 ? `${active.slice(1).map((p) => p.name).join(" and ")} ${active.length > 2 ? "are" : "is"} standing by as backup.` : "No backup provider is configured." }
    : { tone: "warn" as const, title: `Running on backup: ${answering.name} is answering`, text: `${primary.name} is ${primary.state.label.toLowerCase()}. Calls switch back automatically when it recovers.` }
  const HealthIcon = health.tone === "success" ? CheckCircle2 : health.tone === "warn" ? AlertTriangle : XCircle
  const healthBox = { success: "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30", warn: "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30", danger: "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30" }[health.tone]
  const healthIcon = { success: "text-emerald-600 dark:text-emerald-400", warn: "text-amber-600 dark:text-amber-400", danger: "text-red-600 dark:text-red-400" }[health.tone]

  // Group switches by route (groq → gemini) with the reasons the earlier providers were passed over.
  const routes = new Map<string, { from: string; to: string; count: number; reasons: string[]; last: string }>()
  for (const c of switches) {
    const skipped = skippedReasons(c.fallbackFrom!)
    const from = skipped.map((s) => s.provider).join(" → ")
    const key = `${from}→${c.provider}`
    const r = routes.get(key) ?? { from, to: c.provider, count: 0, reasons: [], last: c.at }
    r.count++
    r.reasons.push(...skipped.map((s) => s.why))
    if (c.at > r.last) r.last = c.at
    routes.set(key, r)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI usage</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Which AI provider is answering the CRM&apos;s entity checks and agent, over the last 24 hours.</p>
      </div>

      <div className={`flex items-start gap-3 rounded-xl border p-4 ${healthBox}`}>
        <HealthIcon className={`mt-0.5 h-5 w-5 shrink-0 ${healthIcon}`} />
        <div>
          <div className="font-medium">{health.title}</div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">{health.text}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Answered", value: answered.length.toLocaleString("en-IN"), hint: "AI calls that got a reply" },
          { label: "Handled by a backup", value: switches.length.toLocaleString("en-IN"), hint: "first choice was busy or down" },
          { label: "Retried attempts", value: failedAttempts.toLocaleString("en-IN"), hint: "failed, then tried again elsewhere" },
          { label: "Tokens used", value: tokens.toLocaleString("en-IN"), hint: "free tiers; no cost" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-5">
              <div className="text-xs text-zinc-500">{s.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</div>
              <div className="mt-1 text-xs text-zinc-500">{s.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {providers.map((p) => {
          const rate = p.calls ? Math.round((p.ok / p.calls) * 100) : null
          return (
            <Card key={p.name} className={p.cfg ? "" : "opacity-60"}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-zinc-500">{p.role}</div>
                    <CardTitle className="mt-0.5 capitalize">{p.name}</CardTitle>
                  </div>
                  <Badge variant={p.state.tone}>{p.state.label}</Badge>
                </div>
                <div className="truncate text-xs text-zinc-500" title={p.cfg?.model ?? PROVIDER_DEFAULTS[p.name].model}>{p.cfg?.model ?? PROVIDER_DEFAULTS[p.name].model}</div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {!p.cfg ? (
                  <p className="text-xs text-zinc-500">{p.name === "groq" ? "Set GROQ_API_KEY (console.groq.com)" : p.name === "gemini" ? "Set GEMINI_API_KEY (aistudio.google.com)" : "Add ollama to LLM_PROVIDERS"}</p>
                ) : p.calls === 0 ? (
                  <p className="text-xs text-zinc-500">No calls in the last 24 hours.</p>
                ) : (
                  <>
                    <div>
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-500">Success rate</span>
                        <span className="tabular-nums font-medium">{rate}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div className={`h-full rounded-full ${rate! >= 90 ? "bg-emerald-500" : rate! >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${rate}%` }} />
                      </div>
                      <div className="mt-1 text-xs tabular-nums text-zinc-500">{p.ok} of {p.calls} calls{p.avgMs != null ? ` · ${(p.avgMs / 1000).toFixed(1)} s each` : ""}</div>
                    </div>
                    {p.topProblems.length > 0 && (
                      <div className="text-xs text-zinc-500">Problems: {p.topProblems.map(([r, n]) => `${r} (${n})`).join(", ")}</div>
                    )}
                    {p.last && <div className="text-xs text-zinc-500">Last call {ago(p.last.at, now)}</div>}
                  </>
                )}
                {(p.state.detail || p.fix) && p.cfg && (
                  <div className={`rounded-md px-2.5 py-2 text-xs ${p.state.tone === "danger" ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"}`}>
                    {p.state.detail ?? p.fix}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader><CardTitle>Automatic switches</CardTitle></CardHeader>
        <CardContent>
          {routes.size === 0 ? <p className="text-sm text-zinc-500">None in the last 24 hours: the first choice answered every call.</p> : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {[...routes.values()].sort((a, b) => b.count - a.count).map((r) => (
                <li key={`${r.from}→${r.to}`} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="flex items-center gap-2 capitalize">
                    <span>{r.from}</span><ArrowRight className="h-3.5 w-3.5 text-zinc-400" /><span className="font-medium">{r.to}</span>
                    <span className="ml-1 normal-case text-zinc-500">{r.count} {r.count === 1 ? "time" : "times"}</span>
                  </div>
                  <div className="text-xs text-zinc-500">
                    {countBy(r.reasons).map(([why, n]) => `${why} (${n})`).join(" · ")} · last {ago(r.last, now)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <details className="group rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <summary className="cursor-pointer select-none px-6 py-4 text-sm font-medium">Recent calls <span className="font-normal text-zinc-500">(latest {recent.length}, for troubleshooting)</span></summary>
        <div className="overflow-x-auto px-6 pb-4">
          {recent.length === 0 ? <p className="text-sm text-zinc-500">No calls yet.</p> : (
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr><th className="py-1.5 pr-3 font-normal">Time</th><th className="pr-3 font-normal">Task</th><th className="pr-3 font-normal">Provider</th><th className="pr-3 font-normal">Result</th><th className="text-right font-normal">Time taken</th></tr>
              </thead>
              <tbody>
                {recent.map((c) => {
                  const ok = c.status === "ok"
                  return (
                    <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-zinc-500" title={c.at}>{when(c.at)}</td>
                      <td className="pr-3" title={c.subjectRef ?? ""}>{TASK[c.purpose] ?? c.purpose}</td>
                      <td className="pr-3 capitalize">{c.provider}</td>
                      <td className="pr-3" title={c.error ?? ""}>
                        {ok ? <span className="text-emerald-700 dark:text-emerald-400">Answered{c.fallbackFrom ? " (as backup)" : ""}</span>
                          : <span className="text-red-700 dark:text-red-400">{reason(c.status, c.httpStatus, c.error)}</span>}
                      </td>
                      <td className="text-right tabular-nums text-zinc-500">{c.latencyMs != null ? `${(c.latencyMs / 1000).toFixed(1)} s` : "–"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </details>
    </div>
  )
}
