import { db } from "@/lib/db"
import { llmCalls } from "@/lib/db/schema"
import { desc, gt, isNotNull, and } from "drizzle-orm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PROVIDER_DEFAULTS, providersFromEnv, type ProviderName } from "@/lib/llm/router"
import { relativeDate } from "@/lib/utils"

export const dynamic = "force-dynamic"

const STATUS_VARIANT: Record<string, "success" | "warn" | "danger" | "info" | "secondary"> = {
  ok: "success", rate_limited: "warn", quota_exhausted: "danger", error: "danger", invalid_output: "warn",
}

const time = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })

export default async function AiUsagePage() {
  const now = new Date()
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString()
  const [recent, day, resting] = await Promise.all([
    db.select().from(llmCalls).orderBy(desc(llmCalls.at)).limit(100),
    db.select().from(llmCalls).where(gt(llmCalls.at, since)),
    db.select().from(llmCalls).where(and(isNotNull(llmCalls.cooldownUntil), gt(llmCalls.cooldownUntil, now.toISOString()))).orderBy(desc(llmCalls.at)),
  ])
  const configured = providersFromEnv()
  const names: ProviderName[] = ["groq", "gemini", "ollama"]
  const switches = day.filter((c) => c.status === "ok" && c.fallbackFrom)

  const perProvider = names.map((name) => {
    const cfg = configured.find((p) => p.name === name)
    const rows = day.filter((c) => c.provider === name)
    const last = recent.find((c) => c.provider === name)
    const lastOk = recent.find((c) => c.provider === name && c.status === "ok")
    const rest = resting.find((c) => c.provider === name)
    // A success after the cooldown was set means the provider is back.
    const restingUntil = rest && !(lastOk && lastOk.at > rest.at) ? rest.cooldownUntil : null
    const ok = rows.filter((c) => c.status === "ok")
    return {
      name, cfg, restingUntil, last,
      calls: rows.length, ok: ok.length, failed: rows.length - ok.length,
      tokens: ok.reduce((s, c) => s + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0),
      avgMs: ok.length ? Math.round(ok.reduce((s, c) => s + (c.latencyMs ?? 0), 0) / ok.length) : null,
      lastError: recent.find((c) => c.provider === name && c.status !== "ok"),
    }
  })

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI usage</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every model call the CRM makes (entity checks, the AI agent): which provider answered, and when it switched because a free quota or rate limit ran out.
          Order: <code>{configured.map((p) => p.name).join(" → ") || "none configured"}</code> (set with <code>LLM_PROVIDERS</code>).
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {perProvider.map((p) => (
          <Card key={p.name}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {p.name}
                {!p.cfg ? <Badge variant="secondary">not configured</Badge> : p.restingUntil ? <Badge variant="warn">resting</Badge> : <Badge variant="success">available</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="text-zinc-500">Model <code>{p.cfg?.model ?? PROVIDER_DEFAULTS[p.name].model}</code></div>
              {!p.cfg && <div className="text-xs text-zinc-500">{p.name === "groq" ? "Set GROQ_API_KEY (console.groq.com)" : p.name === "gemini" ? "Set GEMINI_API_KEY (aistudio.google.com)" : "Add ollama to LLM_PROVIDERS"}</div>}
              {p.restingUntil && <div className="text-amber-700 dark:text-amber-300">Skipped until {time(p.restingUntil)}</div>}
              <div className="tabular-nums">Last 24 h: {p.calls} calls · {p.ok} ok · {p.failed} failed</div>
              <div className="tabular-nums text-zinc-500">{p.tokens.toLocaleString()} tokens{p.avgMs != null ? ` · avg ${(p.avgMs / 1000).toFixed(1)} s` : ""}</div>
              {p.last && <div className="text-xs text-zinc-500">Last call {relativeDate(p.last.at)} ({time(p.last.at)})</div>}
              {p.lastError && <div className="text-xs text-red-700 dark:text-red-300" title={p.lastError.error ?? ""}>Last problem: {p.lastError.status} · {(p.lastError.error ?? "").slice(0, 120)}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Automatic switches (last 24 h): {switches.length}</CardTitle></CardHeader>
        <CardContent>
          {switches.length === 0 ? <p className="text-sm text-zinc-500">No switches: every call was answered by the first available provider.</p> : (
            <ul className="space-y-1 text-sm">
              {switches.slice(0, 20).map((c) => (
                <li key={c.id}><span className="tabular-nums text-zinc-500">{time(c.at)}</span> · answered by <b>{c.provider}</b> after {c.fallbackFrom}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Call log (latest 100)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {recent.length === 0 ? <p className="text-sm text-zinc-500">No calls yet.</p> : (
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr><th className="py-1 pr-3">Time</th><th className="pr-3">Purpose</th><th className="pr-3">Provider / model</th><th className="pr-3">Status</th><th className="pr-3 text-right">Latency</th><th className="pr-3 text-right">Tokens</th><th className="pr-3">Subject</th><th>Note</th></tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                    <td className="py-1 pr-3 tabular-nums whitespace-nowrap">{time(c.at)}</td>
                    <td className="pr-3">{c.purpose}</td>
                    <td className="pr-3 whitespace-nowrap">{c.provider} / {c.model}</td>
                    <td className="pr-3"><Badge variant={STATUS_VARIANT[c.status] ?? "secondary"}>{c.status}{c.httpStatus && c.status !== "ok" ? ` ${c.httpStatus}` : ""}</Badge></td>
                    <td className="pr-3 text-right tabular-nums">{c.latencyMs != null ? `${(c.latencyMs / 1000).toFixed(1)} s` : "–"}</td>
                    <td className="pr-3 text-right tabular-nums">{c.inputTokens != null ? `${c.inputTokens}/${c.outputTokens ?? 0}` : "–"}</td>
                    <td className="pr-3 max-w-40 truncate" title={c.subjectRef ?? ""}>{c.subjectRef ?? "–"}</td>
                    <td className="max-w-72 truncate text-zinc-500" title={[c.fallbackFrom ? `after ${c.fallbackFrom}` : "", c.error ?? "", c.cooldownUntil ? `resting until ${c.cooldownUntil}` : ""].filter(Boolean).join(" · ")}>
                      {[c.fallbackFrom ? `after ${c.fallbackFrom}` : "", c.error ?? "", c.cooldownUntil ? `resting until ${time(c.cooldownUntil)}` : ""].filter(Boolean).join(" · ") || "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
