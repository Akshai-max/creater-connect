// Reset CR001 back to its original state after the smoke test
import { db } from "../lib/db"
import { creators, activities, tasks, tags } from "../lib/db/schema"
import { eq, sql, and, like } from "drizzle-orm"

async function main() {
  const id = "CR001"
  // Restore original stage
  await db.update(creators).set({ stage: "Past Hire", stageChangedAt: new Date().toISOString() }).where(eq(creators.id, id))
  // Remove the smoke-test note + auto-task + tag activities
  await db.delete(activities).where(and(eq(activities.creatorId, id), like(activities.body, "%[smoke test]%")))
  await db.delete(activities).where(and(eq(activities.creatorId, id), like(activities.title, "Stage: Past Hire → Outreached")))
  await db.delete(activities).where(and(eq(activities.creatorId, id), like(activities.title, "Auto-task: Follow up if no reply")))
  await db.delete(activities).where(and(eq(activities.creatorId, id), like(activities.title, "Tag added: demo-pilot")))
  await db.delete(tasks).where(and(eq(tasks.creatorId, id), like(tasks.title, "Follow up if no reply")))
  await db.delete(tags).where(and(eq(tags.creatorId, id), eq(tags.name, "demo-pilot")))
  console.log("✅ CR001 reset to clean state")
}
main()
