import { db } from "@/lib/db"
import { leads } from "@/lib/db/schema"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { and, asc, eq, sql, type SQL } from "drizzle-orm"
import Link from "next/link"
import { Download, Star } from "lucide-react"
import { buildExport } from "@/lib/leads/export"
import { formatNumber } from "@/lib/utils"
import { statusVariant } from "@/lib/leads/ui"

export const dynamic = "force-dynamic"

const TABS = ["qualified", "priority-a", "unverified", "rejected", "all"] as const
const PAGE_SIZE = 50

// Everything is filtered, counted, sorted and paged in Postgres, and only the columns
// the table shows are loaded, so the page stays fast as discovery adds thousands of leads.
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ tab?: string; fixtures?: string; page?: string }> }) {
  const params = await searchParams
  const tab = (TABS.includes(params.tab as any) ? params.tab : "qualified") as (typeof TABS)[number]
  const showFixtures = params.fixtures === "1"
  const visible = showFixtures ? undefined : eq(leads.isFixture, false)
  const tabFilter: SQL | undefined = tab === "all" ? undefined : tab === "priority-a" ? eq(leads.priority, "A") : eq(leads.candidateStatus, tab)
  const where = and(visible, tabFilter)

  const [statusRows, priorityRows, fixtureRows, qualifiedRows, totalRows] = await Promise.all([
    db.select({ status: leads.candidateStatus, n: sql<number>`count(*)::int` }).from(leads).where(visible).groupBy(leads.candidateStatus),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(and(visible, eq(leads.priority, "A"))),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(eq(leads.isFixture, true)),
    // The validation report only covers qualified leads, so only those are loaded in full.
    db.select().from(leads).where(and(visible, eq(leads.candidateStatus, "qualified"))),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(where),
  ])
  const counts: Record<string, number> = { qualified: 0, unverified: 0, rejected: 0 }
  for (const r of statusRows) counts[r.status] = Number(r.n)
  const priorityA = Number(priorityRows[0]?.n ?? 0)
  const fixtureCount = Number(fixtureRows[0]?.n ?? 0)
  const { report } = buildExport(qualifiedRows)

  const total = Number(totalRows[0]?.n ?? 0)
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const requested = Math.floor(Number(params.page) || 1)
  const page = Math.min(Math.max(1, requested), pages)
  const list = await db
    .select({
      id: leads.id, creatorName: leads.creatorName, segment: leads.segment, primaryPlatform: leads.primaryPlatform, followers: leads.followers,
      candidateStatus: leads.candidateStatus, priority: leads.priority, leadScore: leads.leadScore, countryIso2: leads.countryIso2,
      contentCount30d: leads.contentCount30d, longformCount60d: leads.longformCount60d, bestChannel: leads.bestChannel,
      backupChannel: leads.backupChannel, rejectionReason: leads.rejectionReason,
    })
    .from(leads)
    .where(where)
    .orderBy(sql`${leads.leadScore} desc nulls last`, asc(leads.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
  const q = (t: string, p = 1) => `/leads?tab=${t}${showFixtures ? "&fixtures=1" : ""}${p > 1 ? `&page=${p}` : ""}`

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
      <Pager page={page} pages={pages} total={total} pageSize={PAGE_SIZE} href={(p) => q(tab, p)} />
    </div>
  )
}

function Pager({ page, pages, total, pageSize, href }: { page: number; pages: number; total: number; pageSize: number; href: (p: number) => string }) {
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  // First, last, and two either side of the current page, with gaps marked.
  const nums = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-medium"
  const off = `${btn} border border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800`
  return (
    <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-zinc-500 tabular-nums">{from}–{to} of {total}</p>
      {pages > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          {page > 1 ? <Link href={href(page - 1)} className={off} rel="prev">Previous</Link> : <span className={`${off} pointer-events-none opacity-40`} aria-disabled="true">Previous</span>}
          {nums.map((n, i) => (
            <span key={n} className="flex items-center gap-1">
              {i > 0 && n - nums[i - 1] > 1 && <span className="px-1 text-xs text-zinc-400">…</span>}
              {n === page
                ? <span aria-current="page" className={`${btn} bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 tabular-nums`}>{n}</span>
                : <Link href={href(n)} className={`${off} tabular-nums`}>{n}</Link>}
            </span>
          ))}
          {page < pages ? <Link href={href(page + 1)} className={off} rel="next">Next</Link> : <span className={`${off} pointer-events-none opacity-40`} aria-disabled="true">Next</span>}
        </div>
      )}
    </nav>
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
