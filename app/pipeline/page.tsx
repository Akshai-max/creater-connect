import { db } from "@/lib/db"
import { creators, tasks } from "@/lib/db/schema"
import { and, eq, ne, sql } from "drizzle-orm"
import { isStage } from "@/lib/stages"
import { PipelineBoard, type BoardCard } from "./board"

export const dynamic = "force-dynamic"

export default async function PipelinePage() {
  const [all, openTasks] = await Promise.all([
    db.select().from(creators).where(ne(creators.status, "archived")),
    db
      .select({
        creatorId: tasks.creatorId,
        open: sql<number>`count(*)::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.dueDate} < to_char(now(), 'YYYY-MM-DD'))::int`,
      })
      .from(tasks)
      .where(and(eq(tasks.completed, false)))
      .groupBy(tasks.creatorId),
  ])
  const taskBy = new Map(openTasks.map((t) => [t.creatorId, t]))

  const cards: BoardCard[] = all.map((c) => ({
    id: c.id,
    name: c.name,
    handle: c.handle,
    platform: c.platform,
    followers: c.followers,
    avatarUrl: c.avatarUrl,
    niche: c.niche,
    owner: c.owner,
    hasEmail: !!c.email,
    stage: isStage(c.stage) ? c.stage : "Lead",
    stageChangedAt: c.stageChangedAt,
    openTasks: taskBy.get(c.id)?.open ?? 0,
    overdueTasks: taskBy.get(c.id)?.overdue ?? 0,
  }))

  return <PipelineBoard initialCards={cards} />
}
