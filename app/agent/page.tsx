import { db } from "@/lib/db"
import { agentProposals, agentRuns } from "@/lib/db/schema"
import { desc, eq, ne } from "drizzle-orm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { senderFromEnv } from "@/lib/leads/config"
import { agentModel, agentProvider, ollamaUrl } from "@/lib/agent/config"
import { relativeDate } from "@/lib/utils"
import { RunPanel } from "./run-panel"
import { ProposalCard } from "./proposal-card"

export const dynamic = "force-dynamic"

export default async function AgentPage() {
  const [runs, pending, decided] = await Promise.all([
    db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(8),
    db.select().from(agentProposals).where(eq(agentProposals.status, "pending")).orderBy(desc(agentProposals.createdAt)),
    db.select().from(agentProposals).where(ne(agentProposals.status, "pending")).orderBy(desc(agentProposals.decidedAt)).limit(15),
  ])
  const provider = agentProvider()
  const ollamaUp = provider === "ollama" ? await ollamaStatus(ollamaUrl(), agentModel()) : null
  const setup = {
    apiKey: !!process.env.ANTHROPIC_API_KEY,
    ready: provider === "ollama" ? ollamaUp === "ready" : !!process.env.ANTHROPIC_API_KEY,
    sender: !!senderFromEnv(),
    resend: !!process.env.RESEND_API_KEY,
    testMode: (process.env.OUTREACH_MODE ?? "test") !== "live",
  }
  const spent = runs.reduce((s, r) => s + (r.costUsd ?? 0), 0)

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI agent</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Picks creators worth contacting, drafts personalised messages and suggests next steps, using only stored evidence.
          It never sends: every proposal waits for your review.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Run the agent</CardTitle></CardHeader>
          <CardContent><RunPanel
            ready={setup.ready}
            notReadyHint={provider === "ollama"
              ? ollamaUp === "no-model" ? `Model ${agentModel()} isn't pulled yet: run "docker compose up ollama-pull".` : `Ollama isn't reachable at ${ollamaUrl()}: run "docker compose up -d".`
              : "Set ANTHROPIC_API_KEY in .env.local (or AGENT_PROVIDER=ollama) and restart the dev server to run the agent."}
            slow={provider === "ollama"}
          /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Setup</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {provider === "ollama"
              ? <SetupRow ok={setup.ready} label="Ollama (Docker)" hint={ollamaUp === "ready" ? `${agentModel()} loaded, free and local` : ollamaUp === "no-model" ? "running, model not pulled" : "not reachable: docker compose up -d"} />
              : <SetupRow ok={setup.apiKey} label="ANTHROPIC_API_KEY" hint="needed to run the agent" />}
            <SetupRow ok={setup.sender} label="SENDER_* identity" hint="pitches are rejected without it" />
            <SetupRow ok={setup.resend} label="RESEND_API_KEY" hint="without it, approved emails save as drafts" />
            <SetupRow ok={setup.testMode} label="Test mode" hint="only allowlisted recipients can be emailed" />
            <p className="pt-2 text-xs text-zinc-500">Provider: {provider} · model <code>{agentModel()}</code> · last {runs.length} runs cost ${spent.toFixed(4)}</p>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Waiting for review <span className="text-sm font-normal text-zinc-500">({pending.length})</span></h2>
        {pending.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-zinc-500">Nothing to review. Run the agent to get proposals.</CardContent></Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {pending.map((p) => <ProposalCard key={p.id} proposal={p} />)}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recent runs</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {runs.length === 0 && <p className="text-sm text-zinc-500">No runs yet.</p>}
            {runs.map((r) => (
              <div key={r.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={r.status === "succeeded" ? "success" : r.status === "failed" ? "danger" : "info"}>{r.status}</Badge>
                  <span className="text-xs text-zinc-500">{relativeDate(r.startedAt)} · {r.trigger} · {JSON.parse(r.sources).join(", ")}</span>
                  <span className="ml-auto text-xs tabular-nums text-zinc-500">
                    {r.proposals} proposals · {((r.durationMs ?? 0) / 1000).toFixed(0)}s · ${(r.costUsd ?? 0).toFixed(4)}
                  </span>
                </div>
                {r.error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{r.error}</p>}
                {r.summary && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">{r.summary}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent decisions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {decided.length === 0 && <p className="text-sm text-zinc-500">No decisions yet.</p>}
            {decided.map((p) => (
              <div key={p.id} className="flex items-start gap-2 text-sm">
                <Badge variant={p.status === "sent" || p.status === "approved" ? "success" : p.status === "failed" ? "danger" : "secondary"}>{p.status}</Badge>
                <div className="min-w-0">
                  <div className="truncate"><span className="font-medium">{p.subjectName}</span> <span className="text-zinc-500">· {label(p.kind, p.action)}</span></div>
                  {p.result && <div className="text-xs text-zinc-500">{p.result}</div>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function label(kind: string, action: string | null) {
  if (kind === "pitch") return `${action} pitch`
  if (kind === "candidate_decision") return `${action} candidate`
  return (action ?? "").replace("_", " ")
}

function SetupRow({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className={ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{ok ? "✓" : "!"}</span>
      <div><div className="font-medium">{label}</div><div className="text-xs text-zinc-500">{hint}</div></div>
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
