import { db } from "@/lib/db"
import { leads } from "@/lib/db/schema"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { eq } from "drizzle-orm"
import Link from "next/link"
import { Download, Star } from "lucide-react"
import { buildExport } from "@/lib/leads/export"
import { formatNumber } from "@/lib/utils"
import { statusVariant } from "@/lib/leads/ui"

export const dynamic = "force-dynamic"

const TABS = ["qualified", "priority-a", "unverified", "rejected", "all"] as const


export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ tab?: string; fixtures?: string }> }) {
  const params = await searchParams
  const tab = (TABS.includes(params.tab as any) ? params.tab : "qualified") as (typeof TABS)[number]
  const showFixtures = params.fixtures === "1"
  const all = (await db.select().from(leads)).filter((l) => showFixtures || !l.isFixture)
  const { report } = buildExport(all)
  const counts = { qualified: 0, unverified: 0, rejected: 0 } as Record<string, number>
  for (const l of all) counts[l.candidateStatus] = (counts[l.candidateStatus] ?? 0) + 1
  const priorityA = all.filter((l) => l.priority === "A").length
  const fixtureCount = (await db.select({ id: leads.id }).from(leads).where(eq(leads.isFixture, true))).length

  const list = all
    .filter((l) => tab === "all" || (tab === "priority-a" ? l.priority === "A" : l.candidateStatus === tab))
    .sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0) || a.id.localeCompare(b.id))
    .slice(0, 300)
  const q = (t: string) => `/leads?tab=${t}${showFixtures ? "&fixtures=1" : ""}`

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Evidence-qualified creators. Qualification is rule-based and separate from AI fit scores.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a href={`/api/export/leads${showFixtures ? "?fixtures=1" : ""}`} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 text-xs font-medium h-8 px-3">
            <Download className="h-3.5 w-3.5" /> leads.csv
          </a>
          <a href={`/api/export/leads?all=1${showFixtures ? "&fixtures=1" : ""}`} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-xs font-medium h-8 px-3">
            <Download className="h-3.5 w-3.5" /> Audit CSV (all)
          </a>
          <a href={`/api/export/leads?report=1${showFixtures ? "&fixtures=1" : ""}`} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-xs font-medium h-8 px-3">
            Validation report
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Stat label="Qualified" value={counts.qualified} />
        <Stat label="Priority A" value={priorityA} />
        <Stat label="Unverified" value={counts.unverified} />
        <Stat label="Rejected" value={counts.rejected} />
        <Stat label="Export problems" value={report.problems.length} />
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle>Dataset validation (qualified leads)</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          <div className="flex flex-wrap gap-2">
            {report.distribution.checks.map((c) => (
              <Badge key={c.id} variant={c.pass ? "success" : "danger"} title={c.detail}>{c.pass ? "✓" : "✗"} {c.detail}</Badge>
            ))}
            <Badge variant={report.duplicates ? "danger" : "success"}>{report.duplicates} duplicates</Badge>
            <Badge variant={report.incomplete ? "danger" : "success"}>{report.incomplete} incomplete</Badge>
          </div>
          <div className="text-xs text-zinc-500">
            By country: {Object.entries(report.distribution.byCountry).map(([k, v]) => `${k} ${v.count} (${(v.share * 100).toFixed(0)}%)`).join(" · ") || "—"}
          </div>
          {fixtureCount > 0 && (
            <div className="text-xs text-amber-700 dark:text-amber-300">
              {fixtureCount} fictional fixture leads are stored and {showFixtures ? "shown" : "hidden"} (<Link className="underline" href={showFixtures ? "/leads" : "/leads?fixtures=1"}>{showFixtures ? "hide" : "show"}</Link>). They never appear in the official export.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {TABS.map((t) => (
          <Link key={t} href={q(t)} className={`px-3 py-1 rounded-md text-xs font-medium capitalize ${tab === t ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
            {t.replace("-", " ")}
          </Link>
        ))}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Creator</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Activity</TableHead>
              <TableHead>Best / backup</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-sm text-zinc-500 py-8">No leads here yet. Run <code>npm run engine -- --input your-file.csv</code>.</TableCell></TableRow>
            )}
            {list.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <Link href={`/leads/${l.id}`} className="font-medium hover:underline">{l.creatorName}</Link>
                  <div className="text-[11px] text-zinc-500">{l.id} · {l.segment ?? "—"} · {l.primaryPlatform} · {formatNumber(l.followers)}</div>
                </TableCell>
                <TableCell><Badge variant={statusVariant(l.candidateStatus)}>{l.candidateStatus}</Badge></TableCell>
                <TableCell>{l.priority === "A" ? <Badge variant="info"><Star className="h-3 w-3 mr-1" />A</Badge> : <span className="text-xs text-zinc-500">{l.priority ?? "—"}</span>}</TableCell>
                <TableCell className="text-right tabular-nums">{l.leadScore?.toFixed(1) ?? "—"}</TableCell>
                <TableCell>{l.countryIso2 ?? "—"}</TableCell>
                <TableCell className="text-xs">{l.contentCount30d ?? 0}/30d · {l.longformCount60d ?? 0} LF/60d</TableCell>
                <TableCell className="text-xs">{l.bestChannel ?? "—"} / {l.backupChannel ?? "—"}</TableCell>
                <TableCell className="text-xs text-zinc-600 dark:text-zinc-400 max-w-xs truncate" title={l.rejectionReason ?? ""}>{l.rejectionReason ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {list.length === 300 && <p className="text-xs text-zinc-500 mt-2">Showing the top 300. Download the CSV for the full list.</p>}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-zinc-500">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  )
}
