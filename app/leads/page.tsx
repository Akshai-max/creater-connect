import { db } from "@/lib/db"
import { leads } from "@/lib/db/schema"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm"
import Link from "next/link"
import { ArrowDown, ArrowUp, Check, Download, Search, Star, X } from "lucide-react"
import { buildExport } from "@/lib/leads/export"
import { formatNumber, relativeDate } from "@/lib/utils"
import { statusVariant } from "@/lib/leads/ui"

export const dynamic = "force-dynamic"

const TABS = ["qualified", "new", "priority-a", "unverified", "rejected", "all"] as const
const TAB_LABEL: Record<(typeof TABS)[number], string> = { qualified: "Qualified", new: "New", "priority-a": "Priority A", unverified: "Unverified", rejected: "Rejected", all: "All" }
const SORTS = ["score", "activity", "followers", "name", "newest"] as const
type Sort = (typeof SORTS)[number]
const PAGE_SIZE = 50
// The New tab: leads first stored within this window (created_at), whatever their status.
// The first discovery run was a day ago, so "today" would show almost everything; a short window
// shows what the scheduled cycle just found.
const WINDOWS = { "2h": { hours: 2, label: "Last 2 hours" }, "24h": { hours: 24, label: "Last 24 hours" }, "7d": { hours: 168, label: "Last 7 days" } } as const
type Window = keyof typeof WINDOWS

type Params = { tab?: string; fixtures?: string; page?: string; q?: string; country?: string; sort?: string; dir?: string; window?: string }

// Everything is filtered, counted, sorted and paged in Postgres, and only the columns
// the table shows are loaded, so the page stays fast as discovery adds thousands of leads.
export default async function LeadsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams
  const tab = (TABS.includes(params.tab as any) ? params.tab : "qualified") as (typeof TABS)[number]
  const showFixtures = params.fixtures === "1"
  const search = (params.q ?? "").trim().slice(0, 80)
  const country = /^[A-Za-z]{2}$/.test(params.country ?? "") ? params.country!.toUpperCase() : ""
  const defaultSort: Sort = tab === "new" ? "newest" : "score"
  const sort = (SORTS.includes(params.sort as any) ? params.sort : defaultSort) as Sort
  const dir = params.dir === "asc" ? "asc" : sort === "name" ? "asc" : "desc"
  const window = (params.window && params.window in WINDOWS ? params.window : "2h") as Window
  const since = new Date(Date.now() - WINDOWS[window].hours * 3_600_000).toISOString()

  const visible = showFixtures ? undefined : eq(leads.isFixture, false)
  const newFilter = sql`${leads.createdAt}::timestamptz >= ${since}::timestamptz`
  const tabFilter: SQL | undefined = tab === "all" ? undefined : tab === "new" ? newFilter : tab === "priority-a" ? eq(leads.priority, "A") : eq(leads.candidateStatus, tab)
  const like = search ? `%${search.replace(/[%_\\]/g, "\\$&")}%` : null
  const searchFilter = like ? or(ilike(leads.creatorName, like), ilike(leads.id, like)) : undefined
  const countryFilter = country ? eq(leads.countryIso2, country) : undefined
  const where = and(visible, tabFilter, searchFilter, countryFilter)

  const [statusRows, priorityRows, fixtureRows, qualifiedRows, totalRows, countryRows, newRows] = await Promise.all([
    db.select({ status: leads.candidateStatus, n: sql<number>`count(*)::int` }).from(leads).where(visible).groupBy(leads.candidateStatus),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(and(visible, eq(leads.priority, "A"))),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(eq(leads.isFixture, true)),
    // The validation report only covers qualified leads, so only those are loaded in full.
    db.select().from(leads).where(and(visible, eq(leads.candidateStatus, "qualified"))),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(where),
    db.select({ c: leads.countryIso2 }).from(leads).where(visible).groupBy(leads.countryIso2).orderBy(asc(leads.countryIso2)),
    db.select({ status: leads.candidateStatus, n: sql<number>`count(*)::int` }).from(leads).where(and(visible, newFilter)).groupBy(leads.candidateStatus),
  ])
  const newCounts: Record<string, number> = { qualified: 0, unverified: 0, rejected: 0 }
  for (const r of newRows) newCounts[r.status] = Number(r.n)
  const newTotal = newCounts.qualified + newCounts.unverified + newCounts.rejected
  const counts: Record<string, number> = { qualified: 0, unverified: 0, rejected: 0 }
  for (const r of statusRows) counts[r.status] = Number(r.n)
  const priorityA = Number(priorityRows[0]?.n ?? 0)
  const fixtureCount = Number(fixtureRows[0]?.n ?? 0)
  const tabCount: Record<(typeof TABS)[number], number> = {
    qualified: counts.qualified, new: newTotal, "priority-a": priorityA, unverified: counts.unverified, rejected: counts.rejected,
    all: counts.qualified + counts.unverified + counts.rejected,
  }
  const countries = countryRows.map((r) => r.c).filter((c): c is string => !!c)
  const { report } = buildExport(qualifiedRows)

  const total = Number(totalRows[0]?.n ?? 0)
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const requested = Math.floor(Number(params.page) || 1)
  const page = Math.min(Math.max(1, requested), pages)

  const order = (d: typeof asc) => ({
    score: [sql`${leads.leadScore} ${sql.raw(dir)} nulls last`],
    activity: [sql`${leads.contentCount30d} ${sql.raw(dir)} nulls last`, sql`${leads.longformCount60d} ${sql.raw(dir)} nulls last`],
    followers: [sql`${leads.followers} ${sql.raw(dir)} nulls last`],
    name: [d(leads.creatorName)],
    newest: [sql`${leads.createdAt}::timestamptz ${sql.raw(dir)} nulls last`],
  })[sort]
  const list = await db
    .select({
      id: leads.id, creatorName: leads.creatorName, segment: leads.segment, primaryPlatform: leads.primaryPlatform, followers: leads.followers,
      candidateStatus: leads.candidateStatus, priority: leads.priority, leadScore: leads.leadScore, countryIso2: leads.countryIso2,
      contentCount30d: leads.contentCount30d, longformCount60d: leads.longformCount60d, bestChannel: leads.bestChannel,
      backupChannel: leads.backupChannel, rejectionReason: leads.rejectionReason, createdAt: leads.createdAt,
    })
    .from(leads)
    .where(where)
    .orderBy(...order(dir === "asc" ? asc : desc), asc(leads.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)

  const href = (o: { tab?: string; page?: number; sort?: string; dir?: string; window?: Window } = {}) => {
    const u = new URLSearchParams()
    const t = o.tab ?? tab
    u.set("tab", t)
    if (showFixtures) u.set("fixtures", "1")
    if (search) u.set("q", search)
    if (country) u.set("country", country)
    if (t === "new" && (o.window ?? window) !== "2h") u.set("window", o.window ?? window)
    // Switching tab resets the sort to that tab's default (New: newest first; others: score).
    const s = o.sort ?? (o.tab && o.tab !== tab ? undefined : sort)
    const d = o.dir ?? (o.tab && o.tab !== tab ? undefined : dir)
    const tDefault = t === "new" ? "newest" : "score"
    if (s && d && (s !== tDefault || d !== "desc")) { u.set("sort", s); u.set("dir", d) }
    if ((o.page ?? 1) > 1) u.set("page", String(o.page))
    return `/leads?${u}`
  }
  const sortHref = (s: Sort) => href({ sort: s, dir: s === sort ? (dir === "desc" ? "asc" : "desc") : s === "name" ? "asc" : "desc" })
  const filtered = !!(search || country)
  const showReason = tab === "unverified" || tab === "rejected" || tab === "all" || tab === "new"
  const showAdded = tab === "new" || sort === "newest"
  const cols = 7 + (showReason ? 1 : 0) + (showAdded ? 1 : 0)

  const checks = [
    ...report.distribution.checks.map((c) => ({ id: c.id, pass: c.pass, text: c.detail })),
    { id: "duplicates", pass: !report.duplicates, text: `${report.duplicates} duplicates` },
    { id: "incomplete", pass: !report.incomplete, text: `${report.incomplete} incomplete rows` },
  ]
  const failing = checks.filter((c) => !c.pass)
  const byCountry = Object.entries(report.distribution.byCountry).sort((a, b) => b[1].count - a[1].count)

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
          <a href={`/api/export/leads?all=1${showFixtures ? "&fixtures=1" : ""}`} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-xs font-medium h-8 px-3 hover:bg-zinc-100 dark:hover:bg-zinc-900">
            <Download className="h-3.5 w-3.5" /> Audit CSV (all)
          </a>
          <a href={`/api/export/leads?report=1${showFixtures ? "&fixtures=1" : ""}`} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 text-xs font-medium h-8 px-3 hover:bg-zinc-100 dark:hover:bg-zinc-900">
            Validation report
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Stat label="Qualified" value={counts.qualified} href={href({ tab: "qualified" })} tone="good" active={tab === "qualified"} />
        <Stat label="Priority A" value={priorityA} href={href({ tab: "priority-a" })} active={tab === "priority-a"} />
        <Stat label="Unverified" value={counts.unverified} href={href({ tab: "unverified" })} active={tab === "unverified"} />
        <Stat label="Rejected" value={counts.rejected} href={href({ tab: "rejected" })} active={tab === "rejected"} />
        <Stat label="Export problems" value={report.problems.length} tone={report.problems.length ? "bad" : "good"} hint={report.problems.length ? "see dataset validation" : "none"} />
      </div>

      <Card className="mb-6 p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold">Dataset validation</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Checks on the qualified leads, which are what leads.csv exports.</p>
          </div>
          <Badge variant={failing.length ? "danger" : "success"}>{failing.length ? `${failing.length} of ${checks.length} checks failing` : `All ${checks.length} checks pass`}</Badge>
        </div>
        <ul className="mt-4 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-sm">
          {[...failing, ...checks.filter((c) => c.pass)].map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              {c.pass ? <Check className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" /> : <X className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />}
              <span className={c.pass ? "text-zinc-500 dark:text-zinc-400" : ""}>{c.text}</span>
            </li>
          ))}
        </ul>
        {byCountry.length > 0 && (
          <div className="mt-4">
            <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              {byCountry.map(([k, v], i) => (
                <div key={k} title={`${k}: ${v.count}`} style={{ width: `${v.share * 100}%` }} className={["bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500", "bg-zinc-400"][Math.min(i, 4)]} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 tabular-nums">
              {byCountry.map(([k, v]) => <span key={k}>{k} {v.count} ({(v.share * 100).toFixed(0)}%)</span>)}
            </div>
          </div>
        )}
        {fixtureCount > 0 && (
          <div className="mt-4 text-xs text-amber-700 dark:text-amber-300">
            {fixtureCount} fictional fixture leads are stored and {showFixtures ? "shown" : "hidden"} (<Link className="underline" href={showFixtures ? "/leads" : "/leads?fixtures=1"}>{showFixtures ? "hide" : "show"}</Link>). They never appear in the official export.
          </div>
        )}
      </Card>

      <div className="flex items-center gap-1 mb-4 flex-wrap rounded-lg bg-zinc-100 dark:bg-zinc-900 p-1 w-fit">
        {TABS.map((t) => (
          <Link key={t} href={href({ tab: t })} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${tab === t ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"}`}>
            {TAB_LABEL[t]}
            <span className="tabular-nums text-zinc-500">{tabCount[t]}</span>
          </Link>
        ))}
      </div>

      {tab === "new" && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <div className="flex items-center gap-1">
            {(Object.keys(WINDOWS) as Window[]).map((w) => (
              <Link key={w} href={href({ window: w })} className={`rounded-full border px-2.5 py-1 ${window === w ? "border-zinc-900 bg-zinc-900 text-zinc-50 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900" : "border-zinc-200 text-zinc-600 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"}`}>
                {WINDOWS[w].label}
              </Link>
            ))}
          </div>
          <span className="text-zinc-500 tabular-nums">
            {newTotal} added · <span className="text-emerald-600 dark:text-emerald-400">{newCounts.qualified} qualified</span> · {newCounts.unverified} unverified · {newCounts.rejected} rejected
          </span>
          <span className="text-zinc-400">New channels from the scheduled search; each row says what it still needs.</span>
        </div>
      )}

      <form method="get" action="/leads" className="mb-4 flex items-center gap-2 flex-wrap">
        <input type="hidden" name="tab" value={tab} />
        {showFixtures && <input type="hidden" name="fixtures" value="1" />}
        {(sort !== "score" || dir !== "desc") && (<><input type="hidden" name="sort" value={sort} /><input type="hidden" name="dir" value={dir} /></>)}
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-400" />
          <input name="q" defaultValue={search} placeholder="Search name or lead id" className="h-8 w-64 rounded-md border border-zinc-200 bg-transparent pl-8 pr-2 text-xs outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-800" />
        </div>
        <select name="country" defaultValue={country} className="h-8 rounded-md border border-zinc-200 bg-transparent px-2 text-xs dark:border-zinc-800" aria-label="Country">
          <option value="">All countries</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="submit" className="h-8 rounded-md bg-zinc-900 px-3 text-xs font-medium text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900">Apply</button>
        {filtered && <Link href={href({ page: 1 }).replace(/&?(q|country)=[^&]*/g, "")} className="text-xs text-zinc-500 underline">Clear filters</Link>}
      </form>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><SortLink label="Creator" s="name" sort={sort} dir={dir} href={sortHref("name")} /></TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead className="text-right"><SortLink label="Score" s="score" sort={sort} dir={dir} href={sortHref("score")} right /></TableHead>
              <TableHead>Country</TableHead>
              <TableHead><SortLink label="Activity" s="activity" sort={sort} dir={dir} href={sortHref("activity")} /></TableHead>
              <TableHead>Best / backup</TableHead>
              {showReason && <TableHead>Why</TableHead>}
              {showAdded && <TableHead className="text-right"><SortLink label="Added" s="newest" sort={sort} dir={dir} href={sortHref("newest")} right /></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 && (
              <TableRow>
                <TableCell colSpan={cols} className="text-center text-sm text-zinc-500 py-10">
                  {filtered ? "No leads match these filters." : tab === "new" ? `No new channels in the ${WINDOWS[window].label.toLowerCase()}. The scheduled search runs about every 40 minutes.` : <>No leads here yet. Run <code>npm run engine -- --input your-file.csv</code>.</>}
                </TableCell>
              </TableRow>
            )}
            {list.map((l) => {
              const reasons = (l.rejectionReason ?? "").split(" | ").filter(Boolean)
              const first = reasons[0]?.replace(/^[a-z_]+:\s*/i, "")
              return (
                <TableRow key={l.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                  <TableCell>
                    <Link href={`/leads/${l.id}`} className="font-medium hover:underline">{l.creatorName}</Link>
                    <div className="text-[11px] text-zinc-500 capitalize">
                      {l.primaryPlatform}{l.segment && l.segment.toLowerCase() !== l.primaryPlatform?.toLowerCase() ? ` · ${l.segment}` : ""} · {formatNumber(l.followers)} followers
                      <span className="ml-2 font-mono text-zinc-400 normal-case">{l.id}</span>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={statusVariant(l.candidateStatus)}>{l.candidateStatus}</Badge></TableCell>
                  <TableCell>{l.priority === "A" ? <Badge variant="info"><Star className="h-3 w-3 mr-1" />A</Badge> : <span className="text-xs text-zinc-500">{l.priority && l.priority !== "N/A" ? l.priority : "—"}</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.leadScore?.toFixed(1) ?? "—"}</TableCell>
                  <TableCell>{l.countryIso2 ?? "—"}</TableCell>
                  <TableCell className="text-xs tabular-nums">{l.contentCount30d ?? 0} / 30d · {l.longformCount60d ?? 0} long-form / 60d</TableCell>
                  <TableCell className="text-xs">{l.bestChannel ?? "—"}<span className="text-zinc-400"> / </span>{l.backupChannel ?? "—"}</TableCell>
                  {showReason && (
                    <TableCell className="text-xs text-zinc-600 dark:text-zinc-400 max-w-xs" title={reasons.join("\n")}>
                      <div className="line-clamp-2">{first ?? ""}</div>
                      {reasons.length > 1 && <span className="text-zinc-400">+{reasons.length - 1} more</span>}
                    </TableCell>
                  )}
                  {showAdded && (
                    <TableCell className="text-right text-xs text-zinc-500 whitespace-nowrap" title={l.createdAt ?? ""}>{l.createdAt ? relativeDate(l.createdAt) : "—"}</TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>
      <Pager page={page} pages={pages} total={total} pageSize={PAGE_SIZE} href={(p) => href({ page: p })} />
    </div>
  )
}

function SortLink({ label, s, sort, dir, href, right }: { label: string; s: Sort; sort: Sort; dir: string; href: string; right?: boolean }) {
  const on = s === sort
  return (
    <Link href={href} className={`inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 ${right ? "justify-end" : ""} ${on ? "text-zinc-900 dark:text-zinc-100" : ""}`}>
      {label}
      {on && (dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
    </Link>
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

function Stat({ label, value, href, tone, hint, active }: { label: string; value: number; href?: string; tone?: "good" | "bad"; hint?: string; active?: boolean }) {
  const color = tone === "good" && value > 0 ? "text-emerald-500" : tone === "bad" ? "text-red-500" : ""
  const body = (
    <Card className={`p-4 h-full ${href ? "hover:bg-zinc-50 dark:hover:bg-zinc-900/60" : ""} ${active ? "ring-1 ring-zinc-400 dark:ring-zinc-600" : ""}`}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="text-[11px] text-zinc-500 mt-0.5">{hint}</div>}
    </Card>
  )
  return href ? <Link href={href} className="block">{body}</Link> : body
}
