import { db } from "@/lib/db"
import { creators, candidates, outreach, tasks } from "@/lib/db/schema"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { sql, eq, desc, and, ne } from "drizzle-orm"
import Link from "next/link"
import { ArrowRight, Sparkles, Users, Mail, Kanban, ListTodo, AlertCircle, TrendingUp } from "lucide-react"
import { STAGES, STAGE_COLORS, type Stage } from "@/lib/stages"
import { formatNumber, relativeDate } from "@/lib/utils"
import { TodayTaskRow } from "./today-task-row"
import { Avatar } from "@/components/avatar"
import { BRAND_NAME } from "@/lib/brand"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const allCreators = await db.select().from(creators)
  const [
    pendingCandidates,
    sentOutreach,
    recentCandidates,
    openTasksRaw,
    stageRows,
  ] = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(candidates).where(eq(candidates.status, "pending")).then(r => Number(r[0]?.c ?? 0)),
    db.select({ c: sql<number>`count(*)` }).from(outreach).where(eq(outreach.status, "sent")).then(r => Number(r[0]?.c ?? 0)),
    db.select().from(candidates).where(eq(candidates.status, "pending")).orderBy(desc(candidates.fitScore)).limit(5),
    db.select().from(tasks).where(eq(tasks.completed, false)).orderBy(tasks.dueDate),
    db.select({ stage: creators.stage, c: sql<number>`count(*)` }).from(creators).groupBy(creators.stage),
  ])
  const creatorCount = allCreators.length

  // Map creator id → name for Today widget
  const creatorNameById = new Map(allCreators.map((c) => [c.id, c.name]))

  // Today's tasks: due ≤ end of today (or overdue)
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  const todayTasks = openTasksRaw
    .filter((t) => t.dueDate && new Date(t.dueDate) <= endOfToday)
    .slice(0, 12)
    .map((t) => ({ ...t, creatorName: t.creatorId ? (creatorNameById.get(t.creatorId) ?? null) : null }))
  const overdueCount = openTasksRaw.filter((t) => t.dueDate && new Date(t.dueDate) < new Date(new Date().setHours(0, 0, 0, 0))).length

  // Stage counts
  const stageCounts: Record<string, number> = {}
  for (const r of stageRows) stageCounts[r.stage ?? "Lead"] = Number(r.c) // count() arrives as a string from Postgres

  // Stuck leads: in non-terminal stage > 14 days, no recent activity
  const STUCK_DAYS = 14
  const stuckCutoff = new Date()
  stuckCutoff.setDate(stuckCutoff.getDate() - STUCK_DAYS)
  const stuckCreators = allCreators
    .filter((c) => {
      const s = (c.stage as Stage) ?? "Lead"
      if (["Past Hire", "Cold", "Paid", "Lead"].includes(s)) return false
      if (!c.stageChangedAt) return false
      return new Date(c.stageChangedAt) < stuckCutoff
    })
    .slice(0, 6)

  const activeStages = ["Outreached", "Replied", "Negotiating", "Briefed", "Content In", "Live"]
  const inFlight = activeStages.reduce((sum, s) => sum + (stageCounts[s] ?? 0), 0)

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{BRAND_NAME} creator program · {creatorCount} in roster · {pendingCandidates} candidates pending review</p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <StatCard icon={<Users className="h-4 w-4" />} label="Roster" value={creatorCount} href="/creators" />
        <StatCard icon={<Sparkles className="h-4 w-4" />} label="Pending review" value={pendingCandidates} href="/candidates" highlight={pendingCandidates > 0} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="In flight" value={inFlight} href="/pipeline" />
        <StatCard icon={<ListTodo className="h-4 w-4" />} label="Tasks today" value={todayTasks.length} href="#today" highlight={overdueCount > 0} />
        <StatCard icon={<Mail className="h-4 w-4" />} label="Outreach sent" value={sentOutreach} href="/outreach" />
      </div>

      {/* Pipeline overview */}
      <Card className="mb-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50 text-base font-semibold">
            <Kanban className="h-4 w-4" /> Pipeline overview
          </CardTitle>
          <Link href="/pipeline" className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center gap-1">
            Open Kanban <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {STAGES.map((s) => (
              <Link key={s} href="/pipeline" className={`rounded-md border px-3 py-2 ${STAGE_COLORS[s as Stage]} hover:opacity-80 transition-opacity`}>
                <div className="text-[10px] uppercase tracking-wide font-medium opacity-80">{s}</div>
                <div className="text-xl font-semibold tabular-nums">{stageCounts[s] ?? 0}</div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Today widget */}
        <Card id="today">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50 text-base font-semibold">
              <ListTodo className="h-4 w-4" /> Today
              {overdueCount > 0 && <Badge variant="danger">{overdueCount} overdue</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {todayTasks.length === 0 ? (
              <p className="text-sm text-zinc-500 px-2 py-3">No tasks due today. Move someone through the pipeline to auto-create follow-ups.</p>
            ) : (
              <div className="space-y-1">
                {todayTasks.map((t) => <TodayTaskRow key={t.id} task={t as any} />)}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stuck leads widget */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50 text-base font-semibold">
              <AlertCircle className="h-4 w-4" /> Stuck &gt;{STUCK_DAYS} days in stage
              {stuckCreators.length > 0 && <Badge variant="warn">{stuckCreators.length}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stuckCreators.length === 0 ? (
              <p className="text-sm text-zinc-500 px-2 py-3">Nothing stuck — everyone's moving 🎉</p>
            ) : (
              <div className="space-y-2">
                {stuckCreators.map((c) => (
                  <Link key={c.id} href={`/creators/${c.id}`} className="block rounded-md border border-zinc-200 dark:border-zinc-800 p-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{c.name}</div>
                        <div className="text-xs text-zinc-500">{c.handle ?? "—"} · stuck since {relativeDate(c.stageChangedAt)}</div>
                      </div>
                      <Badge variant="warn">{c.stage}</Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50 text-base font-semibold">
              <Sparkles className="h-4 w-4" /> New candidates from Apify
            </CardTitle>
            <Link href="/candidates" className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center gap-1">
              Review all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentCandidates.length === 0 && <p className="text-sm text-zinc-500">No pending candidates.</p>}
            {recentCandidates.map((c) => (
              <Link key={c.id} href={`/candidates/${c.id}`} className="flex items-start gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
                <Avatar name={c.fullName ?? c.handle} url={c.avatarUrl} candidateId={c.id} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{c.handle}</span>
                    {c.isUS && <Badge variant="info">🇺🇸 US</Badge>}
                    {c.nicheRelevant && <Badge variant="success">on-niche</Badge>}
                    {c.fitScore != null && <Badge variant="outline">{c.fitScore.toFixed(1)}/10</Badge>}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1 truncate">{c.fullName}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {formatNumber(c.followers)} followers · {c.engagementRate?.toFixed(1)}% ER · {c.rateBand}
                  </div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, href, highlight }: { icon: React.ReactNode; label: string; value: number | string; href?: string; highlight?: boolean }) {
  const inner = (
    <Card className={highlight ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20" : ""}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 text-xs mb-1">
          {icon} {label}
        </div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}
