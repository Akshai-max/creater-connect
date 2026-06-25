import { db } from "@/lib/db"
import { activities } from "@/lib/db/schema"

export async function logActivity(opts: {
  creatorId: string
  type: string
  title: string
  body?: string | null
  metadata?: Record<string, any>
  actor?: string
}) {
  const id = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  await db.insert(activities).values({
    id,
    creatorId: opts.creatorId,
    type: opts.type,
    title: opts.title,
    body: opts.body ?? null,
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
    actor: opts.actor ?? "You",
  } as any)
}

export function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
