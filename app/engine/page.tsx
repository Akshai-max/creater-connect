import { db } from "@/lib/db"
import { engineRuns, seedTestEvents } from "@/lib/db/schema"
import { desc } from "drizzle-orm"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { listSeedTests } from "@/lib/leads/seed-repo"
import { seedReport } from "@/lib/leads/seed-test"
import { parseJson } from "@/lib/leads/ui"
import { relativeDate } from "@/lib/utils"
import { SeedEventButtons } from "./seed-event-buttons"

export const dynamic = "force-dynamic"

// What the scheduled cycle (scripts/engine-cycle.ts) did before a run; absent for manual runs.
type CycleMetrics = {
  discovery?: { status: "added" | "none_new" | "skipped" | "failed" | "off"; added: number; units: number; sources: string[]; reason?: string; nextAt?: string | null; unitsToday?: number; dailyUnits?: number }
  entityCheck?: { checked: number; individual: number; excluded: number; forReview: number; errors: number; stopped?: string | null } | { failed: string } | null
}
const cycleOf = (metrics: string | null) => parseJson<{ cycle?: CycleMetrics }>(metrics, {}).cycle ?? null
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

function DiscoveryCell({ cycle }: { cycle: CycleMetrics | null }) {
  const d = cycle?.discovery
  if (!d) return <span className="text-zinc-400" title="Manual run: no discovery step">—</span>
  const e = cycle?.entityCheck
  const entity = e && "checked" in e && e.checked > 0
    ? <div className="text-[11px] text-zinc-500">entity check: {e.individual} individual · {e.excluded} excluded · {e.forReview} for review</div>
    : e && "failed" in e ? <div className="text-[11px] text-red-600 dark:text-red-400">entity check failed: {e.failed}</div> : null
  if (d.status === "added" || d.status === "none_new") {
    return (
      <div>
        <details>
          <summary className="cursor-pointer">
            {d.added > 0 ? <Badge variant="success">+{d.added} new</Badge> : <Badge variant="secondary">searched, 0 new</Badge>}
            <span className="ml-1 text-[11px] text-zinc-500">{d.units}u</span>
          </summary>
          <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-500">{d.sources.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </details>
        {entity}
      </div>
    )
  }
  if (d.status === "failed") return <div><Badge variant="danger">search failed</Badge><div className="text-[11px] text-zinc-500 max-w-56">{d.reason}</div></div>
  if (d.status === "off") return <span className="text-zinc-400">off</span>
  return (
    <div className="text-[11px] text-zinc-500 max-w-56" title={d.reason}>
      no search{d.nextAt ? ` · next ${hhmm(d.nextAt)}` : ""}
      {d.reason && /budget/.test(d.reason) && <div className="text-amber-600">daily quota for discovery used</div>}
    </div>
  )
}

export default async function EnginePage() {
  const runs = await db.select().from(engineRuns).orderBy(desc(engineRuns.startedAt)).limit(30)
  const tests = await listSeedTests(5)
  const events = tests.length ? await db.select().from(seedTestEvents) : []
  const latestCycle = runs.map((r) => cycleOf(r.metrics)).find((c) => c?.discovery) ?? null
  const lastAdded = runs.find((r) => (cycleOf(r.metrics)?.discovery?.added ?? 0) > 0)
  const totals = runs.reduce((t, r) => ({ cost: t.cost + (r.costUsd ?? 0), units: t.units + (r.apiUnits ?? 0), failed: t.failed + (r.status === "failed" ? 1 : 0) }), { cost: 0, units: 0, failed: 0 })

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Engine</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Discovery and refresh run history. Start a run with <code className="text-xs">npm run engine -- --input file.csv</code>.
          {" "}{runs.length} runs shown · {totals.failed} failed · ${totals.cost.toFixed(4)} cost · {totals.units} API units
        </p>
        {latestCycle?.discovery && (
          <p className="text-sm text-zinc-500 mt-1">
            New-channel search: {latestCycle.discovery.nextAt ? <>next at <b className="text-zinc-700 dark:text-zinc-300">{hhmm(latestCycle.discovery.nextAt)}</b></> : "not scheduled"}
            {latestCycle.discovery.dailyUnits ? ` · ${latestCycle.discovery.unitsToday ?? 0} / ${latestCycle.discovery.dailyUnits} discovery units used today` : ""}
            {lastAdded ? ` · last added ${cycleOf(lastAdded.metrics)!.discovery!.added} new ${relativeDate(lastAdded.startedAt)}` : ""}.
            {" "}Runs in between only re-check existing leads (&quot;same&quot;) and refresh a few channels.
          </p>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>Runs</CardTitle></CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Runtime</TableHead>
              <TableHead className="text-right">Input</TableHead>
              <TableHead>Discovery</TableHead>
              <TableHead className="text-right">New / upd / same</TableHead>
              <TableHead className="text-right">Qual / unver / rej</TableHead>
              <TableHead className="text-right">Dupes</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead>Errors</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 && <TableRow><TableCell colSpan={11} className="text-center text-sm text-zinc-500 py-6">No runs yet.</TableCell></TableRow>}
            {runs.map((r) => {
              const errs = parseJson<{ ref: string; message: string }[]>(r.errors, [])
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-mono text-xs">{r.id}</div>
                    <div className="text-[11px] text-zinc-500">{r.provider} · {r.inputRef} · {relativeDate(r.startedAt)}</div>
                  </TableCell>
                  <TableCell><Badge variant={r.status === "succeeded" ? "success" : r.status === "failed" ? "danger" : "warn"}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.totalInput}</TableCell>
                  <TableCell className="text-xs align-top"><DiscoveryCell cycle={cycleOf(r.metrics)} /></TableCell>
                  <TableCell className="text-right tabular-nums">{r.inserted} / {r.updated} / {r.unchanged}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.qualified} / {r.unverified} / {r.rejected}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.duplicates}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.failed}</TableCell>
                  <TableCell className="text-right tabular-nums">${(r.costUsd ?? 0).toFixed(4)}{r.apiUnits ? ` · ${r.apiUnits}u` : ""}</TableCell>
                  <TableCell className="text-xs max-w-xs">
                    {errs.length === 0 ? <span className="text-zinc-400">—</span> : (
                      <details><summary className="cursor-pointer">{errs.length} error{errs.length > 1 ? "s" : ""}</summary>
                        <ul className="mt-1 space-y-0.5">{errs.slice(0, 20).map((e, i) => <li key={i} className="text-zinc-500"><span className="font-mono">{e.ref}</span>: {e.message}</li>)}</ul>
                      </details>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader><CardTitle>Seed tests (owned accounts only)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {tests.length === 0 && <p className="text-sm text-zinc-500">No seed tests yet. Set SEED_TEST_ALLOWLIST, then run <code className="text-xs">npm run seed-test -- start</code>.</p>}
          {tests.map((t) => {
            const evs = events.filter((e) => e.seedTestId === t.id)
            const entries = [...new Map(evs.filter((e) => e.eventType === "scheduled").map((e) => [`${e.channel}|${e.recipient}`, { channel: e.channel as any, recipient: e.recipient }])).values()]
            const rep = seedReport(entries, evs)
            return (
              <div key={t.id} className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-xs">{t.id}</span>
                  <Badge variant={rep.pass ? "success" : "warn"}>{rep.pass ? "passed" : "incomplete"}</Badge>
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
