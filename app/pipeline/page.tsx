import { db } from "@/lib/db"
import { creators } from "@/lib/db/schema"
import { eq, ne } from "drizzle-orm"
import Link from "next/link"
import { STAGES, STAGE_COLORS, type Stage } from "@/lib/stages"
import { formatNumber, relativeDate } from "@/lib/utils"
import { StageMover } from "./stage-mover"
import { Badge } from "@/components/ui/badge"

export const dynamic = "force-dynamic"

export default async function PipelinePage() {
  const all = await db.select().from(creators).where(ne(creators.status, "archived"))

  // Group by stage
  const byStage: Record<Stage, typeof all> = Object.fromEntries(STAGES.map((s) => [s, []])) as any
  for (const c of all) {
    const stage = (c.stage as Stage) ?? "Lead"
    if (byStage[stage]) byStage[stage].push(c)
    else byStage["Lead"].push(c)
  }

  // Highlight stages with anyone "stuck" (>14 days in stage, excluding terminal stages)
  const STUCK_DAYS = 14
  const isStuck = (stageChangedAt: string | null, stage: Stage) => {
    if (!stageChangedAt) return false
    if (["Past Hire", "Cold", "Paid", "Lead"].includes(stage)) return false
    const days = (Date.now() - new Date(stageChangedAt).getTime()) / 86400000
    return days >= STUCK_DAYS
  }

  return (
    <div className="px-6 py-6 max-w-[100vw] overflow-x-auto">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {all.length} creators across {STAGES.length} stages · scroll horizontally →
          </p>
        </div>
        <div className="text-xs text-zinc-500">Cards stuck &gt;{STUCK_DAYS}d show ⚠</div>
      </div>

      <div className="flex gap-3 pb-4" style={{ minWidth: "max-content" }}>
        {STAGES.map((stage) => {
          const items = byStage[stage]
          const colorCls = STAGE_COLORS[stage]
          return (
            <div key={stage} className="w-72 shrink-0">
              <div className={`rounded-t-lg border border-b-0 px-3 py-2 ${colorCls}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs uppercase tracking-wide">{stage}</span>
                  <span className="text-xs font-mono">{items.length}</span>
                </div>
              </div>
              <div className="rounded-b-lg border bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-800 min-h-[400px] p-2 space-y-2">
                {items.length === 0 && (
                  <div className="text-xs text-zinc-400 dark:text-zinc-600 text-center py-8">empty</div>
                )}
                {items.map((c) => {
                  const stuck = isStuck(c.stageChangedAt, stage)
                  const type = (c.flagNotes ?? "").match(/Type:\s*([^|]+)/i)?.[1]?.trim()
                  return (
                    <div key={c.id} className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 hover:shadow-sm transition-shadow">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <Link href={`/creators/${c.id}`} className="font-medium text-sm hover:underline truncate flex-1">
                          {c.name}
                        </Link>
                        {stuck && <span title={`Stuck >${STUCK_DAYS} days`} className="text-xs">⚠</span>}
                      </div>
                      <div className="text-[11px] text-zinc-500 mb-1 truncate">{c.handle ?? "—"}</div>
                      <div className="text-[11px] text-zinc-500 mb-2 flex items-center gap-2">
                        <span>{formatNumber(c.followers)}</span>
                        {c.platform && <Badge variant="secondary" className="text-[9px] py-0 px-1">{c.platform}</Badge>}
                      </div>
                      {type && <div className="text-[10px] text-zinc-400 mb-2 truncate">{type}</div>}
                      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                        <span className="text-[10px] text-zinc-400">{relativeDate(c.stageChangedAt)}</span>
                        <StageMover creatorId={c.id} currentStage={stage} compact />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
