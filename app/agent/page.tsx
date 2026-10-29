import { db } from "@/lib/db"
import { agentProposals, agentRuns, candidates, creators, leads } from "@/lib/db/schema"
import type { AgentRun } from "@/lib/db/schema"
import { and, desc, eq, ne, sql } from "drizzle-orm"
import { AlertTriangle, Bot, CheckCircle2, CircleAlert, Clock, Inbox, Loader2, ShieldCheck, XCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { senderFromEnv } from "@/lib/leads/config"
import { agentModel, agentProvider, ollamaUrl } from "@/lib/agent/config"
import { relativeDate } from "@/lib/utils"
import { RunPanel } from "./run-panel"
import { ProposalCard } from "./proposal-card"
import { CopyButton } from "./copy-button"

export const dynamic = "force-dynamic"

const SOURCE_NAME: Record<string, string> = { leads: "Qualified leads", candidates: "Review queue", pipeline: "Pipeline" }
// A run still "running" after this long was cut off (dev server restart, crash) and will never finish.
const STALE_MS = 60 * 60_000

export default async function AgentPage() {
  const [runs, pending, decided, qualifiedRows, fixtureRows, candidateRows, creatorRows] = await Promise.all([
    db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(8),
    db.select().from(agentProposals).where(eq(agentProposals.status, "pending")).orderBy(desc(agentProposals.createdAt)),
    db.select().from(agentProposals).where(ne(agentProposals.status, "pending")).orderBy(desc(agentProposals.decidedAt)).limit(15),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(and(eq(leads.candidateStatus, "qualified"), eq(leads.isFixture, false))),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(and(eq(leads.candidateStatus, "qualified"), eq(leads.isFixture, true))),
    db.select({ n: sql<number>`count(*)::int` }).from(candidates).where(eq(candidates.status, "pending")),
    db.select({ n: sql<number>`count(*)::int` }).from(creators),
  ])
  // What the agent has to work with. The runs that found nothing used to look like successes.
  const available = { leads: Number(qualifiedRows[0]?.n ?? 0), candidates: Number(candidateRows[0]?.n ?? 0), pipeline: Number(creatorRows[0]?.n ?? 0) }
  const fixtureLeads = Number(fixtureRows[0]?.n ?? 0)
  const provider = agentProvider()
  const ollamaUp = provider === "ollama" ? await ollamaStatus(ollamaUrl(), agentModel()) : null
  const hostedKeys = !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY)
  const setup = {
    ready: provider === "ollama" ? ollamaUp === "ready" : provider === "free" ? hostedKeys : !!process.env.ANTHROPIC_API_KEY,
    sender: !!senderFromEnv(),
    resend: !!process.env.RESEND_API_KEY,
    testMode: (process.env.OUTREACH_MODE ?? "test") !== "live",
  }
  const now = Date.now()
  const view = runs.map((r) => ({ ...r, state: runState(r, now) }))
  const spent = runs.reduce((s, r) => s + (r.costUsd ?? 0), 0)
  // Local model on a laptop CPU: the recent runs timed out or lost the connection. Groq/Gemini keys
  // are set, so the hosted free models would do the same work in seconds.
  const ollamaStruggling = provider === "ollama" && view.slice(0, 3).some((r) => r.state === "failed" && /Ollama|socket hang up|ECONNRESET|took over/i.test(r.error ?? ""))
  const providerLabel = provider === "free" ? "Groq / Gemini (free, hosted)" : provider === "ollama" ? "Ollama (local, on this computer)" : "Claude (Anthropic)"

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-8 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">AI agent</h1>
          <p className="mt-1.5 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            Reads the evidence already stored for your leads and pipeline, then suggests who to contact, drafts the first message
            and proposes next steps. <span className="text-zinc-700 dark:text-zinc-300">Nothing is sent until you approve it.</span>
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-800">
          <span className={`h-2 w-2 rounded-full ${setup.ready ? (ollamaStruggling ? "bg-amber-500" : "bg-emerald-500") : "bg-red-500"}`} />
          <span className="text-zinc-600 dark:text-zinc-300">{providerLabel}</span>
          <span className="font-mono text-zinc-400">{agentModel()}</span>
        </div>
      </header>

      {ollamaStruggling && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="space-y-1.5">
            <div className="font-medium">The local model is too slow on this computer</div>
            <p className="leading-6 text-zinc-600 dark:text-zinc-400">
              Recent runs on Ollama ran out of time or lost the connection, because a 4B model on a laptop CPU needs many minutes per step.
              {hostedKeys
                ? <> Your Groq and Gemini keys are already set, so the free hosted models can do the same work in seconds. Set <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/40">AGENT_PROVIDER=free</code> in <code>.env.local</code> and restart the dev server.</>
                : <> Add a free Groq or Gemini key (see AI usage) and set <code>AGENT_PROVIDER=free</code>, or close CPU-heavy apps before running.</>}
            </p>
            {hostedKeys && <CopyButton text="AGENT_PROVIDER=free" label="Copy AGENT_PROVIDER=free" />}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4 text-zinc-400" /> New run</CardTitle>
            <p className="text-xs text-zinc-500">Choose what the agent should look at. Each source shows how much it has to work with.</p>
          </CardHeader>
          <CardContent><RunPanel
            ready={setup.ready}
            notReadyHint={provider === "ollama"
              ? ollamaUp === "no-model" ? `The model ${agentModel()} isn't downloaded yet.` : `Ollama isn't running at ${ollamaUrl()}.`
              : provider === "free" ? "No Groq or Gemini key is set. Add GROQ_API_KEY and/or GEMINI_API_KEY to .env.local and restart the dev server."
              : "No ANTHROPIC_API_KEY is set. Add it to .env.local, or set AGENT_PROVIDER=free to use Groq/Gemini, then restart the dev server."}
            slow={provider === "ollama"}
            available={available}
            fixtureLeads={fixtureLeads}
            fixCommand={provider === "ollama" ? (ollamaUp === "no-model" ? "docker compose up ollama-pull" : "docker compose up -d") : undefined}
          /></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-zinc-400" /> Setup</CardTitle>
            <p className="text-xs text-zinc-500">What the agent needs before its proposals can be used.</p>
          </CardHeader>
          <CardContent className="space-y-3.5 text-sm">
            <SetupRow
              state={!setup.ready ? "bad" : ollamaStruggling ? "warn" : "ok"}
              label="Model"
              hint={provider === "free"
                ? setup.ready ? "Groq first, Gemini if Groq's free quota runs out" : "set GROQ_API_KEY and/or GEMINI_API_KEY"
                : provider === "ollama"
                ? ollamaUp === "ready" ? ollamaStruggling ? "running, but too slow for agent runs" : "running locally, free" : ollamaUp === "no-model" ? "running, model not downloaded" : "not running"
                : setup.ready ? "Claude via your Anthropic key" : "ANTHROPIC_API_KEY missing"}
            />
            <SetupRow state={setup.sender ? "ok" : "bad"} label="Your sender details" hint={setup.sender ? "name and address used in pitches" : "set SENDER_* in .env.local; pitches are rejected without it"} />
            <SetupRow state={setup.resend ? "ok" : "warn"} label="Email delivery" hint={setup.resend ? "approved emails are sent through Resend" : "no RESEND_API_KEY: approved emails are saved as drafts"} />
            <SetupRow state={setup.testMode ? "ok" : "warn"} label="Test mode" hint={setup.testMode ? "emails go only to your allow-listed test addresses" : "LIVE: emails can reach real creators"} />
            <p className="border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
              Last {runs.length} runs cost <span className="tabular-nums">${spent.toFixed(4)}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Waiting for your review</h2>
          <span className="text-xs tabular-nums text-zinc-500">{pending.length} {pending.length === 1 ? "proposal" : "proposals"}</span>
        </div>
        {pending.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <Inbox className="h-6 w-6 text-zinc-300 dark:text-zinc-700" />
              <div className="text-sm font-medium">Nothing to review</div>
              <p className="max-w-sm text-xs leading-5 text-zinc-500">When a run finishes, its suggested pitches and next steps appear here. You can edit each message before approving it.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {pending.map((p) => <ProposalCard key={p.id} proposal={p} />)}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Recent runs</CardTitle></CardHeader>
          <CardContent className="p-0">
            {view.length === 0 && <p className="px-6 pb-6 text-sm text-zinc-500">No runs yet.</p>}
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {view.map((r) => <RunRow key={r.id} run={r} now={now} />)}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Recent decisions</CardTitle></CardHeader>
          <CardContent className="p-0">
            {decided.length === 0 && <p className="px-6 pb-6 text-sm text-zinc-500">No decisions yet. Approved and rejected proposals are listed here.</p>}
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {decided.map((p) => (
                <li key={p.id} className="flex items-start gap-3 px-6 py-3 text-sm">
                  <Badge variant={p.status === "sent" || p.status === "approved" ? "success" : p.status === "failed" ? "danger" : "secondary"} className="capitalize">{p.status}</Badge>
                  <div className="min-w-0">
                    <div className="truncate"><span className="font-medium">{p.subjectName}</span> <span className="text-zinc-500">· {label(p.kind, p.action)}</span></div>
                    {p.result && <div className="mt-0.5 text-xs text-zinc-500">{p.result}</div>}
                  </div>
                  {p.decidedAt && <span className="ml-auto shrink-0 text-xs text-zinc-400">{relativeDate(p.decidedAt)}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

type RunState = "running" | "interrupted" | "failed" | "empty" | "succeeded"
function runState(r: AgentRun, now: number): RunState {
  if (r.status === "running") return now - Date.parse(r.startedAt) > STALE_MS ? "interrupted" : "running"
  if (r.status === "failed") return "failed"
  return r.proposals ? "succeeded" : "empty"
}

const STATE_UI: Record<RunState, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  running: { label: "Running", icon: Loader2, tone: "text-sky-600 dark:text-sky-400" },
  interrupted: { label: "Interrupted", icon: CircleAlert, tone: "text-amber-600 dark:text-amber-400" },
  failed: { label: "Failed", icon: XCircle, tone: "text-red-600 dark:text-red-400" },
  empty: { label: "No proposals", icon: CircleAlert, tone: "text-amber-600 dark:text-amber-400" },
  succeeded: { label: "Done", icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" },
}

function RunRow({ run: r, now }: { run: AgentRun & { state: RunState }; now: number }) {
  const ui = STATE_UI[r.state]
  const Icon = ui.icon
  const sources = parseSources(r.sources).map((s) => SOURCE_NAME[s] ?? s).join(", ")
  const notes = cleanSummary(r.summary)
  const elapsed = r.state === "running" || r.state === "interrupted" ? now - Date.parse(r.startedAt) : r.durationMs
  return (
    <li className="px-6 py-3.5 text-sm">
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ui.tone} ${r.state === "running" ? "animate-spin" : ""}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{ui.label}</span>
            <span className="text-xs text-zinc-500">{sources}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500 tabular-nums">
            <span>{relativeDate(r.startedAt)}</span>
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{r.state === "running" ? `${duration(elapsed)} so far` : duration(elapsed)}</span>
            {r.state !== "running" && r.state !== "interrupted" && <span>{r.proposals} {r.proposals === 1 ? "proposal" : "proposals"}</span>}
            {(r.costUsd ?? 0) > 0 && <span>${(r.costUsd ?? 0).toFixed(4)}</span>}
            {r.model && <span className="font-mono text-zinc-400">{r.model}</span>}
          </div>
          {r.state === "interrupted" && <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">It never finished, probably because the dev server restarted while it ran. Start a new run.</p>}
          {r.state === "failed" && r.error && <p className="mt-1.5 text-xs leading-5 text-red-700 dark:text-red-300" title={r.error}>{plainError(r.error)}</p>}
          {r.state === "empty" && !notes && <p className="mt-1.5 text-xs text-zinc-500">The agent found nothing worth proposing in these sources.</p>}
          {notes && (
            <details className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">
              <summary className="cursor-pointer select-none text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">{r.state === "empty" ? "Why nothing was proposed" : "Model notes"}</summary>
              <p className="mt-2 whitespace-pre-wrap leading-5">{notes}</p>
            </details>
          )}
        </div>
      </div>
    </li>
  )
}

// Raw errors ("socket hang up") in words a reviewer can act on; the original is in the tooltip.
function plainError(e: string) {
  if (/took over \d+ s/i.test(e)) return "The local model took too long on one step and the run was stopped. Use the free hosted models (AGENT_PROVIDER=free) or close CPU-heavy apps."
  if (/socket hang up|ECONNRESET|ECONNREFUSED/i.test(e)) return "Lost the connection to the model server. Ollama stopped or restarted during the run."
  if (/All(Providers)?Unavailable|no LLM provider available/i.test(e)) return "Every model provider was resting after hitting its free limit. Try again later (see AI usage)."
  return e
}

function parseSources(s: string) {
  try { return JSON.parse(s) as string[] } catch { return [] }
}

// 1315000 ms → "21m 55s"; a local model on CPU can take most of an hour.
function duration(ms: number | null) {
  const s = Math.round((ms ?? 0) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

// Reasoning models put their chain of thought in the summary; show the text after it.
function cleanSummary(s: string | null) {
  return (s ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim()
}

function label(kind: string, action: string | null) {
  if (kind === "pitch") return `${action} pitch`
  if (kind === "candidate_decision") return `${action} candidate`
  return (action ?? "").replace("_", " ")
}

function SetupRow({ state, label, hint }: { state: "ok" | "warn" | "bad"; label: string; hint: string }) {
  const Icon = state === "ok" ? CheckCircle2 : state === "warn" ? CircleAlert : XCircle
  const tone = state === "ok" ? "text-emerald-600 dark:text-emerald-400" : state === "warn" ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"
  return (
    <div className="flex items-start gap-2.5">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
      <div className="min-w-0"><div className="font-medium leading-5">{label}</div><div className="text-xs leading-5 text-zinc-500">{hint}</div></div>
    </div>
  )
}

// Is the local Ollama server up, and is the model pulled?
async function ollamaStatus(baseUrl: string, model: string): Promise<"ready" | "no-model" | "down"> {
  try {
    const r = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000), cache: "no-store" })
    if (!r.ok) return "down"
    const { models } = (await r.json()) as { models?: { name: string }[] }
    const want = model.includes(":") ? model : `${model}:latest`
    return models?.some((m) => m.name === want) ? "ready" : "no-model"
  } catch {
    return "down"
  }
}
