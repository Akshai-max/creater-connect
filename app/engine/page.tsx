import { db } from "@/lib/db"
import { engineRuns, seedTestEvents } from "@/lib/db/schema"
import { desc, gte } from "drizzle-orm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { listSeedTests } from "@/lib/leads/seed-repo"
import { seedReport } from "@/lib/leads/seed-test"
import { parseJson } from "@/lib/leads/ui"
import { relativeDate } from "@/lib/utils"
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react"
import { SeedEventButtons } from "./seed-event-buttons"

export const dynamic = "force-dynamic"

// What the scheduled cycle (scripts/engine-cycle.ts) did before a run; absent for manual runs.
type CycleMetrics = {
  discovery?: { status: "added" | "none_new" | "skipped" | "failed" | "off"; added: number; units: number; sources: string[]; reason?: string; nextAt?: string | null; unitsToday?: number; dailyUnits?: number; searchesToday?: number; dailySearches?: number }
  entityCheck?: { checked: number; individual: number; excluded: number; forReview: number; errors: number; stopped?: string | null } | { failed: string } | null
}
const cycleOf = (metrics: string | null) => parseJson<{ cycle?: CycleMetrics }>(metrics, {}).cycle ?? null
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })

function ago(iso: string, now: Date) {
  const m = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m} min ago`
  if (m < 24 * 60) return `${Math.floor(m / 60)} h ago`
  return relativeDate(iso)
}

function DiscoveryCell({ cycle }: { cycle: CycleMetrics | null }) {
  const d = cycle?.discovery
  if (!d) return <span className="text-zinc-400" title="Manual run or before discovery was added: no search step">—</span>
  const e = cycle?.entityCheck
  const entity = e && "checked" in e && e.checked > 0
    ? <div className="mt-1 text-[11px] text-zinc-500">Entity check: {e.individual} individual · {e.excluded} excluded · {e.forReview} to review</div>
    : e && "failed" in e ? <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">Entity check failed: {e.failed}</div> : null
  if (d.status === "added" || d.status === "none_new") {
    return (
      <div>
        <details>
          <summary className="cursor-pointer list-none">
            {d.added > 0 ? <Badge variant="success">+{d.added} new channels</Badge> : <Badge variant="secondary">Searched · none new</Badge>}
          </summary>
          <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-500">{d.sources.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </details>
        {entity}
      </div>
    )
  }
  if (d.status === "failed") return <div><Badge variant="danger">Search failed</Badge><div className="mt-1 max-w-56 text-[11px] text-zinc-500">{d.reason}</div></div>
  if (d.status === "off") return <span className="text-xs text-zinc-400">Off</span>
  if (d.reason && /budget|quota is used/.test(d.reason)) return <span className="text-xs text-amber-600 dark:text-amber-400" title={d.reason}>Key&apos;s quota used: switch key</span>
  return <span className="text-xs text-zinc-400" title={d.reason}>No search this run</span>
}

// Qualified / to review / rejected as one stacked bar, with the numbers under it.
function LeadMix({ q, u, r }: { q: number; u: number; r: number }) {
  const total = q + u + r || 1
  return (
    <div className="w-40" title={`${q} qualified · ${u} to review · ${r} rejected`}>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className="bg-emerald-500" style={{ width: `${(q / total) * 100}%` }} />
        <div className="bg-amber-400" style={{ width: `${(u / total) * 100}%` }} />
        <div className="bg-zinc-400 dark:bg-zinc-600" style={{ width: `${(r / total) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-zinc-500">
        <span className="text-emerald-700 dark:text-emerald-400">{q}</span><span className="text-amber-700 dark:text-amber-400">{u}</span><span>{r}</span>
      </div>
    </div>
  )
}

export default async function EnginePage() {
  const now = new Date()
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0)
  const [runs, today] = await Promise.all([
    db.select().from(engineRuns).orderBy(desc(engineRuns.startedAt)).limit(30),
    db.select({ status: engineRuns.status, metrics: engineRuns.metrics, apiUnits: engineRuns.apiUnits }).from(engineRuns).where(gte(engineRuns.startedAt, startOfDay.toISOString())),
  ])
  const tests = await listSeedTests(5)
  const events = tests.length ? await db.select().from(seedTestEvents) : []
  const latestCycle = runs.map((r) => cycleOf(r.metrics)).find((c) => c?.discovery) ?? null
  const disc = latestCycle?.discovery
  // The run in progress has no counts yet ("checked 0 leads", "0 qualified"), so the banner and
  // tiles describe the last finished run and only mention the one in progress.
  const inProgress = runs[0]?.status === "running" ? runs[0] : null
  const last = runs.find((r) => r.status !== "running")
  const addedToday = today.reduce((s, r) => s + (cycleOf(r.metrics)?.discovery?.added ?? 0), 0)
  const failedToday = today.filter((r) => r.status === "failed").length
  const unitsToday = today.reduce((s, r) => s + (r.apiUnits ?? 0), 0)
  const totalCost = runs.reduce((s, r) => s + (r.costUsd ?? 0), 0)

  const banner = !last ? { tone: "warn" as const, title: "No runs yet", text: "Start one with npm run engine -- --input file.csv, or install the 20-minute schedule." }
    : last.status === "failed" ? { tone: "danger" as const, title: `Last run failed ${ago(last.startedAt, now)}`, text: "Open its errors in the table below." }
    : !inProgress && (now.getTime() - new Date(last.startedAt).getTime()) > 60 * 60_000 ? { tone: "warn" as const, title: `No run for ${ago(last.startedAt, now).replace(" ago", "")}`, text: "The engine normally runs every 20 minutes. Check that the scheduled task is still installed." }
    : { tone: "success" as const, title: inProgress ? `Running now · started ${ago(inProgress.startedAt, now)}` : `Running normally · last run ${ago(last.startedAt, now)}`, text: `The last finished run took ${last.durationMs != null ? `${Math.round(last.durationMs / 1000)} s` : "—"} and checked ${(last.totalInput ?? 0).toLocaleString("en-IN")} leads. Runs between searches re-check existing leads and refresh a few channels.` }
  const BannerIcon = banner.tone === "success" ? CheckCircle2 : banner.tone === "warn" ? AlertTriangle : XCircle
  const bannerBox = { success: "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30", warn: "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30", danger: "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30" }[banner.tone]
  const bannerIcon = { success: "text-emerald-600 dark:text-emerald-400", warn: "text-amber-600 dark:text-amber-400", danger: "text-red-600 dark:text-red-400" }[banner.tone]

  const quotaPct = disc?.dailyUnits ? Math.min(100, ((disc.unitsToday ?? 0) / disc.dailyUnits) * 100) : null
  const searchesUsed = !!disc?.dailySearches && (disc.searchesToday ?? 0) >= disc.dailySearches
  const tiles = [
    { label: "Qualified leads", value: last ? `${last.qualified}` : "—", hint: last ? `${last.unverified} to review · ${last.rejected} rejected` : "" },
    { label: "New channels today", value: `${addedToday}`, hint: disc?.nextAt ? `next search at ${hhmm(disc.nextAt)}` : "no search scheduled" },
    { label: "Runs today", value: `${today.length}`, hint: failedToday ? `${failedToday} failed` : "none failed" },
    // Summed over every run since local midnight, so it can pass 10,000 after a key change: each key
    // has its own 10,000 a day (the card next to it counts the current key).
    { label: "YouTube units today", value: unitsToday.toLocaleString("en-IN"), hint: "all keys used today" },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Engine</h1>
        <p className="mt-1 text-sm text-zinc-500">Finds new creators, re-checks existing leads and keeps their data fresh. It runs on its own every 20 minutes.</p>
      </div>

      <div className={`flex items-start gap-3 rounded-xl border p-4 ${bannerBox}`}>
        <BannerIcon className={`mt-0.5 h-5 w-5 shrink-0 ${bannerIcon}`} />
        <div><div className="font-medium">{banner.title}</div><div className="text-sm text-zinc-600 dark:text-zinc-400">{banner.text}</div></div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="pt-5">
              <div className="text-xs text-zinc-500">{t.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{t.value}</div>
              <div className={`mt-1 text-xs ${t.hint.includes("failed") && !t.hint.startsWith("none") ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>{t.hint}</div>
            </CardContent>
          </Card>
        ))}
        <Card className="col-span-2 lg:col-span-1">
          <CardContent className="pt-5">
            <div className="text-xs text-zinc-500" title="Counted by the app from the calls it made: an API key can't read YouTube's own count (that's in Google Cloud console → YouTube Data API v3 → Quotas). When YouTube replies that the quota is used, the app goes by that.">
              This key&apos;s quota today <span className="text-zinc-400">· app&apos;s count</span>
            </div>
            {disc?.sources?.some((s) => s.startsWith("YouTube says")) && (
              <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">YouTube replied that this key&apos;s quota is used</div>
            )}
            {quotaPct != null ? (
              <div className="mt-2 space-y-2.5">
                {/* The key's two daily limits, as Google's quota page lists them. */}
                {disc!.dailySearches != null && <QuotaBar label="Searches" used={disc!.searchesToday ?? 0} limit={disc!.dailySearches} />}
                <QuotaBar label="Other calls" used={disc!.unitsToday ?? 0} limit={disc!.dailyUnits!} />
                <div className={`text-xs ${searchesUsed || quotaPct >= 90 ? "text-amber-600 dark:text-amber-400" : "text-zinc-500"}`}>
                  {quotaPct >= 90 ? "Used up: switch to a new key"
                    : searchesUsed ? "Searches used up: other sources still run. Switch key for more searches"
                    : `about ${Math.floor(((disc!.dailySearches ?? 0) - (disc!.searchesToday ?? 0)) / 10)} more search steps`}
                </div>
              </div>
            ) : <div className="mt-1 text-sm text-zinc-500">Not set up</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <CardTitle>Recent runs</CardTitle>
            <div className="flex items-center gap-3 text-[11px] text-zinc-500">
              Leads after run:
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />qualified</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />to review</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-zinc-400 dark:bg-zinc-600" />rejected</span>
            </div>
          </div>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">When</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>New channels</TableHead>
              <TableHead>Changes</TableHead>
              <TableHead>Leads after run</TableHead>
              <TableHead className="pr-6 text-right">YouTube units</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-zinc-500">No runs yet.</TableCell></TableRow>}
            {runs.map((r) => {
              const errs = parseJson<{ ref: string; message: string }[]>(r.errors, [])
              const ok = r.status === "succeeded"
              const dupes = r.duplicates ?? 0, failed = r.failed ?? 0
              const changes = [
                r.inserted ? `${r.inserted} added` : null,
                r.updated ? `${r.updated} updated` : null,
              ].filter(Boolean)
              return (
                <TableRow key={r.id} className="align-top">
                  <TableCell className="pl-6">
                    <div className="tabular-nums">{dayLabel(r.startedAt) === dayLabel(now.toISOString()) ? "" : `${dayLabel(r.startedAt)}, `}{hhmm(r.startedAt)}</div>
                    <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600" title={`${r.provider ?? ""} · ${r.inputRef ?? ""}`}>{r.id.replace(/^run_\d+_/, "#")}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-500" /> : r.status === "failed" ? <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" /> : <Clock className="h-4 w-4 text-amber-600" />}
                      <span className="capitalize">{ok ? "Done" : r.status}</span>
                    </div>
                    <div className="text-[11px] tabular-nums text-zinc-500">{r.durationMs != null ? `${Math.round(r.durationMs / 1000)} s` : "—"} · {r.totalInput} leads</div>
                    {errs.length > 0 && (
                      <details className="mt-1 text-[11px]"><summary className="cursor-pointer text-red-600 dark:text-red-400">{errs.length} error{errs.length > 1 ? "s" : ""}</summary>
                        <ul className="mt-1 max-w-xs space-y-0.5">{errs.slice(0, 20).map((e, i) => <li key={i} className="text-zinc-500"><span className="font-mono">{e.ref}</span>: {e.message}</li>)}</ul>
                      </details>
                    )}
                  </TableCell>
                  <TableCell><DiscoveryCell cycle={cycleOf(r.metrics)} /></TableCell>
                  <TableCell className="text-xs">
                    {changes.length ? <div>{changes.join(" · ")}</div> : <div className="text-zinc-400">No changes</div>}
                    {(dupes > 0 || failed > 0) && (
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        {dupes > 0 && `${dupes} duplicates skipped`}{dupes > 0 && failed > 0 && " · "}
                        {failed > 0 && <span className="text-red-600 dark:text-red-400">{failed} failed</span>}
                      </div>
                    )}
                  </TableCell>
                  <TableCell><LeadMix q={r.qualified ?? 0} u={r.unverified ?? 0} r={r.rejected ?? 0} /></TableCell>
                  <TableCell className="pr-6 text-right tabular-nums">
                    {r.apiUnits ?? 0}
                    {(r.costUsd ?? 0) > 0 && <div className="text-[11px] text-zinc-500">${(r.costUsd ?? 0).toFixed(4)}</div>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <div className="border-t border-zinc-200 px-6 py-3 text-[11px] text-zinc-500 dark:border-zinc-800">
          Latest {runs.length} runs{totalCost > 0 ? ` · $${totalCost.toFixed(4)} spent` : " · no paid API cost"}. Manual run: <code>npm run engine -- --input file.csv</code>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seed tests</CardTitle>
          <p className="text-xs text-zinc-500">End-to-end send tests to your own accounts only.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {tests.length === 0 && <p className="text-sm text-zinc-500">No seed tests yet. Add your own test accounts to SEED_TEST_ALLOWLIST, then run <code className="text-xs">npm run seed-test -- start</code>.</p>}
          {tests.map((t) => {
            const evs = events.filter((e) => e.seedTestId === t.id)
            const entries = [...new Map(evs.filter((e) => e.eventType === "scheduled").map((e) => [`${e.channel}|${e.recipient}`, { channel: e.channel as any, recipient: e.recipient }])).values()]
            const rep = seedReport(entries, evs)
            return (
              <div key={t.id} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-xs">{t.id}</span>
                  <Badge variant={rep.pass ? "success" : "warn"}>{rep.pass ? "Passed" : "Incomplete"}</Badge>
                  <span className="text-xs text-zinc-500">{relativeDate(t.createdAt)}</span>
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>Channel</TableHead><TableHead>Recipient</TableHead><TableHead>Expected</TableHead><TableHead>Observed (timestamps)</TableHead><TableHead>Log</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {rep.rows.map((r) => (
                      <TableRow key={r.channel + r.recipient}>
                        <TableCell>{r.channel}</TableCell>
                        <TableCell className="text-xs">{r.recipient}</TableCell>
                        <TableCell className="text-xs">{r.expected.join(" → ")}</TableCell>
                        <TableCell className="text-xs">
                          {r.observed.map((o, i) => <div key={i}>{o.type} · {o.at.replace("T", " ").slice(0, 19)}Z</div>)}
                          {r.missing.length > 0 && <div className="text-amber-600">missing: {r.missing.join(", ")}</div>}
                        </TableCell>
                        <TableCell><SeedEventButtons seedTestId={t.id} channel={r.channel} missing={r.missing} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

function QuotaBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-zinc-600 dark:text-zinc-300">{label}</span>
        <span className="tabular-nums text-zinc-500">{used.toLocaleString("en-IN")} / {limit.toLocaleString("en-IN")}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 60 ? "bg-amber-500" : "bg-sky-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
